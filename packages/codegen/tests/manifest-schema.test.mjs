import assert from "node:assert/strict";
import test from "node:test";

import { SiteManifest } from "../src/manifest-schema.js";

const VALID = {
  siteName: "源动健身",
  brand: { accentColor: "#a9ff57", mode: "dark", slogan: "动起来" },
  navRoutes: [
    { href: "/", fileSubpath: "app/page.tsx" },
    { href: "/courses", fileSubpath: "app/courses/page.tsx" },
    { href: "/trainers", fileSubpath: "app/trainers/page.tsx" },
    { href: "/contact", fileSubpath: "app/contact/page.tsx" },
  ],
  files: [
    { path: "lib/data.ts", content: "export const x = 1;\n" },
    { path: "app/page.tsx", content: "export default function Page(){return null;}\n" },
    { path: "app/layout.tsx", content: "export default function Layout(){return null;}\n" },
    { path: "app/globals.css", content: "@import \"tailwindcss\";\n" },
    { path: "app/components/TopNav.tsx", content: "\"use client\";\nexport default function TopNav(){return null;}\n" },
    { path: "app/components/Footer.tsx", content: "export default function Footer(){return null;}\n" },
    { path: "app/components/Section.tsx", content: "export default function Section(){return null;}\n" },
    { path: "app/courses/page.tsx", content: "export default function Page(){return null;}\n" },
  ],
};

test("SiteManifest accepts a well-formed manifest", () => {
  const result = SiteManifest.safeParse(VALID);
  assert.equal(result.success, true);
});

test("SiteManifest accepts a 3-digit hex accentColor but rejects a named color", () => {
  const shortHex = { ...VALID, brand: { ...VALID.brand, accentColor: "#abc" } };
  assert.equal(SiteManifest.safeParse(shortHex).success, true);
  const named = { ...VALID, brand: { ...VALID.brand, accentColor: "lime" } };
  assert.equal(SiteManifest.safeParse(named).success, false);
});

test("SiteManifest rejects fewer than 4 nav routes", () => {
  const tooFew = { ...VALID, navRoutes: VALID.navRoutes.slice(0, 2) };
  assert.equal(SiteManifest.safeParse(tooFew).success, false);
});

test("SiteManifest rejects files with a disallowed extension", () => {
  const bad = {
    ...VALID,
    files: [...VALID.files, { path: "README.md", content: "x" }],
  };
  assert.equal(SiteManifest.safeParse(bad).success, false);
});

test("SiteManifest rejects a nav href that is not a flat segment", () => {
  const bad = {
    ...VALID,
    navRoutes: [...VALID.navRoutes, { href: "/a/b", fileSubpath: "app/a/b/page.tsx" }],
  };
  assert.equal(SiteManifest.safeParse(bad).success, false);
});

test("SiteManifest rejects more than 40 files", () => {
  const files = Array.from({ length: 41 }, (_, i) => ({
    path: `app/file${i}.tsx`,
    content: "x",
  }));
  assert.equal(SiteManifest.safeParse({ ...VALID, files }).success, false);
});
