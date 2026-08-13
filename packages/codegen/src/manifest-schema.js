// Single source of truth for what the LLM is allowed to return.
// Validated at runtime (callLLM) and the same zod schema is turned into the
// JSON schema sent to the API, so the contract is enforced in one place.
import { z } from "zod";

// Repo-root-relative source path. Allows nested dirs and a known extension,
// forbids leading dots/slashes/separators (so no "../" or absolute paths).
const filePathRegex = /^[A-Za-z0-9][A-Za-z0-9_\-./]*\.(ts|tsx|css|mjs|js|json)$/;

// A nav href. "/" is the home route; everything else is a flat segment.
const hrefRegex = /^\/[a-z0-9-]*$/;

const File = z.object({
  path: z.string().regex(filePathRegex, "file path must be repo-root-relative with a known extension"),
  content: z.string(),
});

const NavRoute = z.object({
  href: z.string().regex(hrefRegex, 'href must be "/" or "/segment"'),
  // The page file backing this route, e.g. "app/courses/page.tsx".
  fileSubpath: z.string().regex(filePathRegex),
});

export const SiteManifest = z.object({
  siteName: z.string().min(1).max(40),
  brand: z.object({
    accentColor: z
      .string()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "accentColor must be a hex color like #a9ff57"),
    mode: z.enum(["dark", "light"]),
    slogan: z.string().min(1),
  }),
  navRoutes: z.array(NavRoute).min(4).max(8),
  files: z.array(File).min(8).max(40),
});

// Trim a manifest so the on-disk tree only keeps files the LLM actually wants
// to override (keeps pages/components/data) and stays within sane bounds.
export function normalizeManifest(manifest) {
  // Dedup files by path, last one wins (matches writeManifest semantics).
  const byPath = new Map();
  for (const f of manifest.files) byPath.set(f.path, f);
  const normalized = { ...manifest, files: [...byPath.values()] };
  validateManifest(normalized);
  return normalized;
}

export function validateManifest(manifest) {
  for (const file of manifest.files) {
    if (file.content.includes("next/font/google")) {
      throw new Error(`Generated file ${file.path} uses next/font/google; builds must not download fonts`);
    }
  }
  const paths = new Set(manifest.files.map((file) => file.path));
  const required = [
    "lib/data.ts",
    "app/layout.tsx",
    "app/globals.css",
    "app/page.tsx",
    "app/components/TopNav.tsx",
    "app/components/Footer.tsx",
    "app/components/Section.tsx",
  ];
  for (const path of required) {
    if (!paths.has(path)) throw new Error(`Manifest is missing required file: ${path}`);
  }
  for (const route of manifest.navRoutes) {
    if (!paths.has(route.fileSubpath)) {
      throw new Error(`Manifest route ${route.href} is missing its page file: ${route.fileSubpath}`);
    }
  }
  const duplicateHrefs = manifest.navRoutes
    .map((route) => route.href)
    .filter((href, index, all) => all.indexOf(href) !== index);
  if (duplicateHrefs.length) throw new Error(`Manifest contains duplicate routes: ${duplicateHrefs.join(", ")}`);
}
