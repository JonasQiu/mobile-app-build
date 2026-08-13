// Copies the canonical Next.js scaffold (templates/next-web) into a working
// directory that the LLM-generated files are then written over the top of.
import { cpSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// packages/codegen/src -> packages/codegen -> packages -> repo root
const repoRoot = resolve(here, "..", "..", "..");

export const TEMPLATE_DIR = join(repoRoot, "templates", "next-web");

// Top-level entries we never want to carry over from the scaffold (either
// machine-generated or unrelated to source).
const SKIP = new Set(["node_modules", ".next", ".git", ".turbo", ".openai", "dist"]);

export function copyTemplate(outDir) {
  if (!existsSync(TEMPLATE_DIR)) {
    throw new Error(`Template not found at ${TEMPLATE_DIR} (expected templates/next-web in the repo root)`);
  }
  cpSync(TEMPLATE_DIR, outDir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(TEMPLATE_DIR, src);
      if (!rel) return true; // the template dir itself
      const top = rel.split(sep)[0];
      return !SKIP.has(top);
    },
  });
  return outDir;
}
