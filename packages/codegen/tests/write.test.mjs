import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
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
