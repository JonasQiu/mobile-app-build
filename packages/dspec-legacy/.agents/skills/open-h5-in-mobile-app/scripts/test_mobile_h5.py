import os
import tempfile
import unittest
from pathlib import Path

from mobile_h5_common import build_deeplink_from_template, load_app_definition, validate_h5_url
from open_h5_in_ios_simulator import select_simulator_from_data
from open_h5_on_android_device import (
    DeviceInfo,
    classify_install_failure,
    parse_aapt_badging,
    parse_adb_devices,
    read_apk_info,
    select_adb,
    select_device_from_data,
)


SKILL_ROOT = Path(__file__).resolve().parents[1]
APPS_TABLE = SKILL_ROOT / "references" / "apps.md"


class CommonTests(unittest.TestCase):
    def test_builds_encoded_deeplink(self):
        deeplink = build_deeplink_from_template(
            "unidriver://web?url={encodedUrl}",
            "https://example.com/a path?x=1&y=2",
        )
        self.assertEqual(
            deeplink,
            "unidriver://web?url=https%3A%2F%2Fexample.com%2Fa%20path%3Fx%3D1%26y%3D2",
        )

    def test_normalizes_xxxx_placeholder(self):
        self.assertEqual(
            build_deeplink_from_template("unidriver://web?url=XXXX", "https://example.com"),
            "unidriver://web?url=https%3A%2F%2Fexample.com",
        )

    def test_loads_platform_specific_app_definition(self):
        android = load_app_definition(APPS_TABLE, "司机端", "android-device")
        ios = load_app_definition(APPS_TABLE, "滴滴车主", "ios-simulator")
        self.assertEqual(android.app_identifier, "com.sdu.didi.gsui")
        self.assertEqual(android.deeplink_template, "unidriver://web?url={encodedUrl}")
        self.assertEqual(ios.app_identifier, "")

    def test_rejects_non_http_h5_url(self):
        with self.assertRaisesRegex(ValueError, "http"):
            validate_h5_url("unidriver://web")


class AndroidTests(unittest.TestCase):
    def test_parses_adb_devices(self):
        devices = parse_adb_devices(
            """List of devices attached
SERIAL-1 device product:foo model:Pixel_8 transport_id:1
SERIAL-2 unauthorized usb:1-2 transport_id:2
"""
        )
        self.assertEqual([device.serial for device in devices], ["SERIAL-1", "SERIAL-2"])
        self.assertEqual(devices[0].details["model"], "Pixel_8")
        self.assertEqual(devices[1].state, "unauthorized")

    def test_selects_only_authorized_physical_device(self):
        devices = [
            DeviceInfo("physical", "device", {"model": "Phone"}, False),
            DeviceInfo("emulator-5554", "device", {"model": "sdk"}, True),
        ]
        self.assertEqual(select_device_from_data(devices).serial, "physical")

    def test_rejects_multiple_physical_devices(self):
        devices = [
            DeviceInfo("one", "device", {}, False),
            DeviceInfo("two", "device", {}, False),
        ]
        with self.assertRaisesRegex(ValueError, "多个"):
            select_device_from_data(devices)

    def test_rejects_unauthorized_device(self):
        with self.assertRaisesRegex(ValueError, "USB 调试授权"):
            select_device_from_data([DeviceInfo("one", "unauthorized", {}, None)])

    def test_parses_aapt_badging(self):
        values = parse_aapt_badging(
            "package: name='com.example.app' versionCode='42' versionName='1.2.3'\n"
            "sdkVersion:'23'\ntargetSdkVersion:'35'\n"
        )
        self.assertEqual(
            values,
            {
                "package_name": "com.example.app",
                "version_code": "42",
                "version_name": "1.2.3",
                "minimum_sdk": "23",
                "target_sdk": "35",
            },
        )

    def test_classifies_signature_mismatch(self):
        message = classify_install_failure("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]")
        self.assertIn("签名不一致", message)
        self.assertIn("不会自动卸载", message)

    def test_explicit_adb_and_apk_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            sdk_root = Path(temp_dir) / "sdk"
            adb = sdk_root / "platform-tools" / "adb"
            adb.parent.mkdir(parents=True)
            adb.write_text("#!/bin/sh\necho 'Android Debug Bridge version test'\n", encoding="utf-8")
            adb.chmod(0o755)

            selection = select_adb(str(adb), Path(temp_dir))
            self.assertEqual(selection.source, "explicit")
            self.assertEqual(selection.sdk_root, str(sdk_root))

            apk = Path(temp_dir) / "app.apk"
            apk.write_bytes(b"not-a-real-apk")
            info = read_apk_info(apk, sdk_root, "com.example.fallback")
            self.assertEqual(info.package_name, "com.example.fallback")
            self.assertEqual(info.metadata_tool, "")

    def test_falls_back_to_aapt_when_apkanalyzer_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            sdk_root = Path(temp_dir) / "sdk"
            apkanalyzer = sdk_root / "cmdline-tools" / "latest" / "bin" / "apkanalyzer"
            aapt = sdk_root / "build-tools" / "37.0.0" / "aapt"
            apkanalyzer.parent.mkdir(parents=True)
            aapt.parent.mkdir(parents=True)
            apkanalyzer.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
            aapt.write_text(
                "#!/bin/sh\n"
                "echo \"package: name='com.example.fromaapt' versionCode='7' versionName='2.0'\"\n"
                "echo \"sdkVersion:'24'\"\n"
                "echo \"targetSdkVersion:'35'\"\n",
                encoding="utf-8",
            )
            apkanalyzer.chmod(0o755)
            aapt.chmod(0o755)
            apk = Path(temp_dir) / "app.apk"
            apk.write_bytes(b"not-a-real-apk")

            info = read_apk_info(apk, sdk_root)
            self.assertEqual(info.package_name, "com.example.fromaapt")
            self.assertEqual(info.version_code, "7")
            self.assertEqual(info.metadata_tool, str(aapt))


class IOSRegressionTests(unittest.TestCase):
    def test_selects_only_booted_iphone(self):
        data = {
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
                    {"name": "iPhone 16", "udid": "booted", "state": "Booted", "isAvailable": True},
                    {"name": "iPhone 15", "udid": "shutdown", "state": "Shutdown", "isAvailable": True},
                ]
            }
        }
        self.assertEqual(select_simulator_from_data(data)["udid"], "booted")


if __name__ == "__main__":
    unittest.main()
