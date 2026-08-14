// Writes a validated manifest onto the scaffolded tree. Each path is checked
// against the target dir: anything that escapes via ".." or an absolute prefix
// is rejected before any byte is written.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export async function writeManifest(outDir, manifest) {
  const root = resolve(outDir);
  for (const file of manifest.files) {
    const abs = resolve(root, file.path);
    const rel = relative(root, abs);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`Refusing to write outside target dir: ${file.path}`);
    }
  }
  const nextFiles = new Set(manifest.files.map((file) => file.path));
  let previous = null;
  try {
    previous = JSON.parse(await readFile(resolve(root, "mobile-build-manifest.json"), "utf8"));
  } catch {
    // A missing or unreadable prior manifest means this is the first write.
  }
  if (previous) {
    if (Array.isArray(previous.generatedFiles)) {
      for (const path of previous.generatedFiles.filter((path) => typeof path === "string" && !nextFiles.has(path))) {
        const abs = resolve(root, path);
        const rel = relative(root, abs);
        if (rel !== ".." && !rel.startsWith(`..${sep}`)) await rm(abs, { force: true });
      }
    } else {
      // Early manifests did not record their file ledger. Replacing only the
      // generated source roots removes stale route files without discarding
      // dependencies, build logs, or checkpoints from the failed step.
      await rm(resolve(root, "app"), { recursive: true, force: true });
      await rm(resolve(root, "lib"), { recursive: true, force: true });
    }
  }
  let count = 0;
  for (const file of manifest.files) {
    const abs = resolve(root, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, "utf8");
    count += 1;
  }
  await writeFile(
    resolve(root, "mobile-build-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      siteName: manifest.siteName,
      brand: manifest.brand,
      navRoutes: manifest.navRoutes,
      generatedFiles: manifest.files.map((file) => file.path),
      source: "requirement-and-mobile-spec",
    }, null, 2) + "\n",
    "utf8",
  );
  return count;
}
