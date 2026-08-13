// Writes a validated manifest onto the scaffolded tree. Each path is checked
// against the target dir: anything that escapes via ".." or an absolute prefix
// is rejected before any byte is written.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export async function writeManifest(outDir, manifest) {
  const root = resolve(outDir);
  let count = 0;
  for (const file of manifest.files) {
    const abs = resolve(root, file.path);
    const rel = relative(root, abs);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`Refusing to write outside target dir: ${file.path}`);
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, "utf8");
    count += 1;
  }
  return count;
}
