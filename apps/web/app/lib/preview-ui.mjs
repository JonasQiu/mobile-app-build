export const PREVIEW_CANVASES = Object.freeze([
  Object.freeze({ id: "desktop", label: "桌面", width: 1440, height: 900 }),
  Object.freeze({ id: "tablet", label: "平板", width: 768, height: 1024 }),
  Object.freeze({ id: "mobile", label: "手机", width: 390, height: 844 }),
]);

const SVG_ROOT = /^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i;
const FORBIDDEN_MARKUP = /<\s*(?:script|style|foreignObject|iframe|object|embed|audio|video|canvas|a)\b/i;
const EVENT_HANDLER = /\son[a-z0-9:_-]+\s*=/i;
const ACTIVE_CONTENT = /(?:javascript\s*:|data\s*:\s*text\/html|<\s*!DOCTYPE|<\s*!ENTITY|<\?xml-stylesheet|@import)/i;
const ATTRIBUTE = /\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const RESOURCE_ATTRIBUTES = new Set(["href", "xlink:href", "src"]);
const CSS_OBFUSCATION = /\\|\/\*|\*\//;

function decodeXmlAttribute(value) {
  let valid = true;
  const decoded = value.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi, (reference, decimal, hexadecimal, named) => {
    if (named) {
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase()];
    }
    const codePoint = Number.parseInt(decimal ?? hexadecimal, decimal ? 10 : 16);
    if (!Number.isInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      valid = false;
      return "";
    }
    return String.fromCodePoint(codePoint);
  });
  if (!valid || /&(?:#|[a-z])/i.test(decoded)) return null;
  return decoded;
}

function safeResource(value) {
  const resource = value.trim();
  return resource.startsWith("#") || /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(resource);
}

function hasOnlySafeCssResources(value) {
  if (CSS_OBFUSCATION.test(value)) return false;
  const urlStart = /url\s*\(/gi;

  while (urlStart.exec(value) !== null) {
    let cursor = urlStart.lastIndex;
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;
    const quote = value[cursor] === '"' || value[cursor] === "'" ? value[cursor++] : null;
    const end = quote ? value.indexOf(quote, cursor) : value.indexOf(")", cursor);
    if (end < 0) return false;

    const resource = value.slice(cursor, end);
    cursor = end + (quote ? 1 : 0);
    if (quote) {
      while (/\s/.test(value[cursor] ?? "")) cursor += 1;
      if (value[cursor] !== ")") return false;
    } else if (/["']/.test(resource)) {
      return false;
    }
    if (!safeResource(resource)) return false;
    urlStart.lastIndex = cursor + 1;
  }

  return true;
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

  for (const match of svg.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    const value = decodeXmlAttribute(match[2] ?? match[3] ?? match[4] ?? "");
    if (value === null || name === "style" || !hasOnlySafeCssResources(value)) return null;
    if (RESOURCE_ATTRIBUTES.has(name) && !safeResource(value)) return null;
  }

  return svg;
}

export function previewIndexAfterMove(currentIndex, direction, length) {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(direction) || length <= 0) return -1;
  const next = currentIndex + Math.sign(direction);
  return next >= 0 && next < length ? next : currentIndex;
}
