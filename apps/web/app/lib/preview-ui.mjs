export const PREVIEW_CANVASES = Object.freeze([
  Object.freeze({ id: "desktop", label: "桌面", width: 1440, height: 900 }),
  Object.freeze({ id: "tablet", label: "平板", width: 768, height: 1024 }),
  Object.freeze({ id: "mobile", label: "手机", width: 390, height: 844 }),
]);

const SVG_ROOT = /^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i;
const FORBIDDEN_MARKUP = /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|canvas|a)\b/i;
const EVENT_HANDLER = /\son[a-z0-9:_-]+\s*=/i;
const ACTIVE_CONTENT = /(?:javascript\s*:|data\s*:\s*text\/html|<\s*!DOCTYPE|<\s*!ENTITY|<\?xml-stylesheet|@import)/i;
const RESOURCE_ATTRIBUTE = /\s(?:href|xlink:href|src)\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi;
const CSS_RESOURCE = /url\(\s*(["']?)(.*?)\1\s*\)/gi;

function safeResource(value) {
  const resource = value.trim();
  return resource.startsWith("#") || /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(resource);
}

/**
 * Treat Runner SVG artifacts as untrusted input. The review surface only renders
 * a complete SVG that has no active elements, event handlers, or external
 * resources. Invalid input fails closed and is never inserted into the DOM.
 */
export function sanitizeReviewSvg(content) {
  if (typeof content !== "string") return null;
  const svg = content.trim();
  if (!SVG_ROOT.test(svg) || FORBIDDEN_MARKUP.test(svg) || EVENT_HANDLER.test(svg) || ACTIVE_CONTENT.test(svg)) return null;

  for (const match of svg.matchAll(RESOURCE_ATTRIBUTE)) {
    const value = match[2] ?? match[3] ?? "";
    if (!safeResource(value)) return null;
  }

  for (const match of svg.matchAll(CSS_RESOURCE)) {
    if (!safeResource(match[2] ?? "")) return null;
  }

  return svg;
}

export function previewIndexAfterMove(currentIndex, direction, length) {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(direction) || length <= 0) return -1;
  const next = currentIndex + Math.sign(direction);
  return next >= 0 && next < length ? next : currentIndex;
}
