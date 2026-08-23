import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generatePreviewSet, readPreviewArtifacts } from "../../../packages/codegen/src/preview.js";
import { PREVIEW_CANVASES, previewIndexAfterMove, sanitizeReviewSvg } from "../app/lib/preview-ui.mjs";

const safeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#fff" /></linearGradient></defs>
  <rect width="100" height="60" fill="url(#g)" />
  <use href="#safe-shape" />
</svg>`;

test("immersive preview exposes the frozen three simulated canvases", () => {
  assert.deepEqual(PREVIEW_CANVASES.map(({ id, width, height }) => [id, width, height]), [
    ["desktop", 1440, 900],
    ["tablet", 768, 1024],
    ["mobile", 390, 844],
  ]);
});

test("review SVG accepts passive markup and same-document references", () => {
  assert.equal(sanitizeReviewSvg(safeSvg), safeSvg);
  assert.match(sanitizeReviewSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AA==" /></svg>`), /data:image\/png/);
});

test("review SVG accepts all three generated preview directions", async (context) => {
  const outDir = await mkdtemp(join(tmpdir(), "preview-ui-safe-"));
  context.after(() => rm(outDir, { recursive: true, force: true }));
  const requirement = "生成三份用于安全回归的现有预览";
  await generatePreviewSet({ outDir, requirement, spec: "# Safe preview fixture", generation: 1 });

  const artifacts = await readPreviewArtifacts({ outDir, requirement });
  assert.equal(artifacts.length, 3);
  for (const artifact of artifacts) assert.equal(sanitizeReviewSvg(artifact.content), artifact.content.trim());
});

test("review SVG fails closed for active content and external resources", () => {
  const unsafe = [
    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>unsafe</div></foreignObject></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><text>open</text></a></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/pixel.png" /></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://example.com/pixel.png)" /></svg>`,
    `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"></svg>`,
  ];
  for (const input of unsafe) assert.equal(sanitizeReviewSvg(input), null);
});

test("review SVG rejects obfuscated CSS resource fetches", () => {
  const unsafe = [
    `<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u\\72l(https://example.invalid/pixel.png)" /></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><style>rect{fill:u/**/rl(https://example.invalid/pixel.png)}</style></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><rect fill=" UrL ( ' HTTPS://example.invalid/pixel.png ' )" /></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\72l(\\68ttps://example.invalid/pixel.png)" /></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u&#x72;l(&#x68;ttps://example.invalid/pixel.png)" /></svg>`,
  ];
  for (const input of unsafe) assert.equal(sanitizeReviewSvg(input), null);
});

test("review SVG rejects prefixed active elements and alternate resource namespaces", () => {
  const unsafe = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:style>rect{fill:url(https://example.invalid/pixel.png)}</s:style></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:s2="http://www.w3.org/2000/svg"><s2:script>alert(1)</s2:script></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:safe-1="http://www.w3.org/2000/svg"><safe-1:foreignObject /></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink"><image xl:href="https://example.invalid/pixel.png" /></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://example.invalid/"><use href="#safe-shape" /></svg>`,
  ];
  for (const input of unsafe) assert.equal(sanitizeReviewSvg(input), null);
});

test("review SVG distinguishes safe ampersands from double-encoded resources", () => {
  const safe = `<svg xmlns="http://www.w3.org/2000/svg" aria-label="R&amp;D" aria-description="#a&amp;b"><use href="&#35;safe-shape" /></svg>`;
  assert.equal(sanitizeReviewSvg(safe), safe);

  const unsafe = [
    `<svg xmlns="http://www.w3.org/2000/svg"><image href="&amp;#x68;ttps://example.invalid/pixel.png" /></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u&amp;#x72;l(https://example.invalid/pixel.png)" /></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><use href="&amp;#35;safe-shape" /></svg>`,
  ];
  for (const input of unsafe) assert.equal(sanitizeReviewSvg(input), null);
});

test("review SVG rejects SMIL activity and resource mutations", () => {
  const unsafe = [
    ["set href to", `<svg xmlns="http://www.w3.org/2000/svg"><image href="#safe"><set attributeName="href" to="https://example.invalid/set.png" /></image></svg>`],
    ["set xml:base to", `<svg xmlns="http://www.w3.org/2000/svg"><g><set attributeName="xml:base" to="https://example.invalid/" /></g></svg>`],
    ["animate href from/to", `<svg xmlns="http://www.w3.org/2000/svg"><image href="#safe"><animate attributeName="href" from="#safe" to="https://example.invalid/to.png" /></image></svg>`],
    ["animate href by", `<svg xmlns="http://www.w3.org/2000/svg"><image href="#safe"><animate attributeName="href" by="https://example.invalid/by.png" /></image></svg>`],
    ["animate href values", `<svg xmlns="http://www.w3.org/2000/svg"><image href="#safe"><animate attributeName="href" values="#safe;https://example.invalid/values.png" /></image></svg>`],
    ["animate xml:base from/to", `<svg xmlns="http://www.w3.org/2000/svg"><g><animate attributeName="xml:base" from="" to="https://example.invalid/" /></g></svg>`],
    ["animate xml:base by", `<svg xmlns="http://www.w3.org/2000/svg"><g><animate attributeName="xml:base" by="https://example.invalid/" /></g></svg>`],
    ["animate xml:base values", `<svg xmlns="http://www.w3.org/2000/svg"><g><animate attributeName="xml:base" values=";https://example.invalid/" /></g></svg>`],
    ["animateMotion", `<svg xmlns="http://www.w3.org/2000/svg"><rect><animateMotion path="M0,0 L20,30" /></rect></svg>`],
    ["animateTransform", `<svg xmlns="http://www.w3.org/2000/svg"><rect><animateTransform attributeName="transform" type="translate" to="40 50" /></rect></svg>`],
    ["animateColor", `<svg xmlns="http://www.w3.org/2000/svg"><rect><animateColor attributeName="fill" to="#fff" /></rect></svg>`],
    ["discard", `<svg xmlns="http://www.w3.org/2000/svg"><rect><discard begin="1s" /></rect></svg>`],
  ];
  assert.deepEqual(
    unsafe.map(([name, input]) => [name, sanitizeReviewSvg(input) === null]),
    unsafe.map(([name]) => [name, true]),
  );
});

test("direction navigation stays within the current three-item batch", () => {
  assert.equal(previewIndexAfterMove(0, -1, 3), 0);
  assert.equal(previewIndexAfterMove(0, 1, 3), 1);
  assert.equal(previewIndexAfterMove(1, 1, 3), 2);
  assert.equal(previewIndexAfterMove(2, 1, 3), 2);
});
