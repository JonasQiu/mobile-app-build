import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { writeManifest } from "../src/write.js";

function tmpOut() {
  return join(tmpdir(), `mbcodegen-write-${randomUUID()}`);
}

test("writeManifest writes nested files and creates parent dirs", async () => {
  const out = tmpOut();
  try {
    const count = await writeManifest(out, {
      siteName: "测试网站",
      brand: { accentColor: "#123456", mode: "light", slogan: "测试" },
      navRoutes: [{ href: "/", fileSubpath: "app/page.tsx" }],
      files: [
        { path: "lib/data.ts", content: "export const x = 1;\n" },
        { path: "app/courses/page.tsx", content: "export default function Page() { return null; }\n" },
      ],
    });
    assert.equal(count, 2);
    const data = await readFile(join(out, "lib/data.ts"), "utf8");
    assert.equal(data, "export const x = 1;\n");
    const pageContent = "export default function Page() { return null; }\n";
    const page = await readFile(join(out, "app/courses/page.tsx"), "utf8");
    assert.equal(page, pageContent);
    const manifest = JSON.parse(await readFile(join(out, "mobile-build-manifest.json"), "utf8"));
    assert.equal(manifest.source, "requirement-and-mobile-spec");
    assert.deepEqual(manifest.generatedFiles, ["lib/data.ts", "app/courses/page.tsx"]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("writeManifest removes stale generated routes during a targeted repair", async () => {
  const out = tmpOut();
  try {
    const base = {
      siteName: "测试网站",
      brand: { accentColor: "#123456", mode: "light", slogan: "测试" },
      navRoutes: [{ href: "/", fileSubpath: "app/page.tsx" }],
    };
    await writeManifest(out, {
      ...base,
      files: [
        { path: "app/page.tsx", content: "export default function Page() { return null; }\n" },
        { path: "app/records/page.tsx", content: "export default function Records() { return null; }\n" },
      ],
    });
    assert.equal(existsSync(join(out, "app/records/page.tsx")), true);
    await writeManifest(out, {
      ...base,
      files: [{ path: "app/page.tsx", content: "export default function Page() { return <main />; }\n" }],
    });
    assert.equal(existsSync(join(out, "app/records/page.tsx")), false);

    await writeFile(join(out, "mobile-build-manifest.json"), JSON.stringify({ source: "legacy" }));
    await writeFile(join(out, "app/stale.tsx"), "stale");
    await writeManifest(out, {
      ...base,
      files: [{ path: "app/page.tsx", content: "export default function Page() { return null; }\n" }],
    });
    assert.equal(existsSync(join(out, "app/stale.tsx")), false);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("writeManifest rejects path-traversal attempts and writes nothing outside", async () => {
  const out = tmpOut();
  const escapePath = join(dirname(out), `mbcodegen-escape-${randomUUID()}.ts`);
  try {
    await assert.rejects(
      writeManifest(out, { files: [{ path: `../${escapePath.split("/").pop()}`, content: "x" }] }),
      /outside target dir/,
    );
    // The guard must have prevented any sibling file from being created.
    assert.equal(existsSync(escapePath), false);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("writeManifest rejects absolute paths", async () => {
  const out = tmpOut();
  try {
    await assert.rejects(
      writeManifest(out, { files: [{ path: "/etc/host", content: "x" }] }),
      /outside target dir/,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
