from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse


@dataclass(frozen=True)
class AppDefinition:
    app_name: str
    platform: str
    aliases: list[str]
    app_identifier: str
    deeplink_template: str
    url_handling: str
    notes: str


def build_deeplink_from_template(template: str, h5_url: str) -> str:
    normalized = template.replace("XXXX", "{encodedUrl}")
    encoded = quote(h5_url, safe="")
    if "{encodedUrl}" in normalized:
        return normalized.replace("{encodedUrl}", encoded)
    if "{url}" in normalized:
        return normalized.replace("{url}", h5_url)
    if h5_url:
        raise ValueError("deeplink template must contain {encodedUrl}, {url}, or XXXX")
    return normalized


def validate_h5_url(h5_url: str) -> None:
    parsed = urlparse(h5_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("H5 URL must use http:// or https:// and include a host")


def split_markdown_row(line: str) -> list[str]:
    return [part.strip().strip("`") for part in line.strip().strip("|").split("|")]


def normalize_identifier(value: str) -> str:
    return "" if value in {"", "-", "—"} else value


def load_app_definition(table_path: Path, app_name: str, platform: str) -> AppDefinition:
    requested_name = app_name.strip().casefold()
    requested_platform = platform.strip().casefold()
    rows = table_path.read_text(encoding="utf-8").splitlines()

    for line in rows:
        if not line.startswith("|") or "---" in line:
            continue
        cells = split_markdown_row(line)
        if len(cells) < 7 or cells[0] == "App":
            continue
        aliases = [alias.strip() for alias in cells[2].split(",") if alias.strip()]
        names = [cells[0], *aliases]
        if requested_platform != cells[1].casefold():
            continue
        if requested_name not in {name.casefold() for name in names}:
            continue
        return AppDefinition(
            app_name=cells[0],
            platform=cells[1],
            aliases=aliases,
            app_identifier=normalize_identifier(cells[3]),
            deeplink_template=cells[4],
            url_handling=cells[5],
            notes=cells[6],
        )

    raise ValueError(f"no app definition found for app={app_name!r}, platform={platform!r}")


def build_deeplink_from_table(table_path: Path, app_name: str, h5_url: str, platform: str) -> str:
    app = load_app_definition(table_path, app_name, platform)
    return build_deeplink_from_template(app.deeplink_template, h5_url)
