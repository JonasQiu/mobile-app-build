import assert from "node:assert/strict";
import test from "node:test";

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

test("direction navigation stays within the current three-item batch", () => {
  assert.equal(previewIndexAfterMove(0, -1, 3), 0);
  assert.equal(previewIndexAfterMove(0, 1, 3), 1);
  assert.equal(previewIndexAfterMove(1, 1, 3), 2);
  assert.equal(previewIndexAfterMove(2, 1, 3), 2);
});
