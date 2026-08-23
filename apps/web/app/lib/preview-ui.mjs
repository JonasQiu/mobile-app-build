export const PREVIEW_CANVASES = Object.freeze([
  Object.freeze({ id: "desktop", label: "桌面", width: 1440, height: 900 }),
  Object.freeze({ id: "tablet", label: "平板", width: 768, height: 1024 }),
  Object.freeze({ id: "mobile", label: "手机", width: 390, height: 844 }),
]);

const SVG_ROOT = /^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)[\s\S]*<\/svg>\s*$/i;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ELEMENT = /<\s*\/?\s*([^\s/>]+)/g;
const FORBIDDEN_ELEMENTS = new Set(["script", "style", "foreignobject", "iframe", "object", "embed", "audio", "video", "canvas", "a"]);
const EVENT_HANDLER = /\son[a-z0-9:_-]+\s*=/i;
const ACTIVE_CONTENT = /(?:javascript\s*:|data\s*:\s*text\/html|<\s*!DOCTYPE|<\s*!ENTITY|<\?xml-stylesheet|@import)/i;
const ATTRIBUTE = /\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const RESOURCE_ATTRIBUTES = new Set(["href", "src"]);
const CSS_OBFUSCATION = /\\|\/\*|\*\//;
const ENCODED_XML_REFERENCE = /&(?:#(?:\d+|x[\da-f]+)|amp|lt|gt|quot|apos);/i;

function isXmlCodePoint(value) {
  return value === 0x9
    || value === 0xa
    || value === 0xd
    || (value >= 0x20 && value <= 0xd7ff)
    || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff);
}

function decodeXmlAttribute(value) {
  let cursor = 0;
  let decoded = "";
  const references = /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi;
  for (const match of value.matchAll(references)) {
    const literal = value.slice(cursor, match.index);
    if (literal.includes("&")) return null;
    decoded += literal;
    if (match[3]) {
      decoded += { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[match[3].toLowerCase()];
    } else {
      const codePoint = Number.parseInt(match[1] ?? match[2], match[1] === undefined ? 16 : 10);
      if (!Number.isInteger(codePoint) || !isXmlCodePoint(codePoint)) return null;
      decoded += String.fromCodePoint(codePoint);
    }
    cursor = match.index + match[0].length;
  }
  const remainder = value.slice(cursor);
  if (remainder.includes("&")) return null;
  decoded += remainder;
  if (ENCODED_XML_REFERENCE.test(decoded)) return null;
  return decoded;
}

function hasCanonicalRootNamespace(svg) {
  const rootStart = svg.search(/<svg(?=\s|>)/i);
  if (rootStart < 0) return false;
  let quote = null;
  let rootEnd = -1;
  for (let index = rootStart + 4; index < svg.length; index += 1) {
    const character = svg[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      rootEnd = index;
      break;
    }
  }
  if (rootEnd < 0) return false;

  const rootTag = svg.slice(rootStart, rootEnd + 1);
  for (const match of rootTag.matchAll(ATTRIBUTE)) {
    if (match[1].toLowerCase() !== "xmlns") continue;
    return decodeXmlAttribute(match[2] ?? match[3] ?? match[4] ?? "") === SVG_NAMESPACE;
  }
  return false;
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
  if (!SVG_ROOT.test(svg) || !hasCanonicalRootNamespace(svg) || EVENT_HANDLER.test(svg) || ACTIVE_CONTENT.test(svg)) return null;

  // Browser DOMParser and Node do not provide one shared, reliably identical
  // namespace-aware parser here. Fail closed on every prefixed name and only
  // allow the canonical default SVG namespace used by Runner artifacts.
  for (const match of svg.matchAll(ELEMENT)) {
    const name = match[1];
    if (name.startsWith("?") || name.startsWith("!")) continue;
    if (name.includes(":") || FORBIDDEN_ELEMENTS.has(name.toLowerCase())) return null;
  }

  for (const match of svg.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    const value = decodeXmlAttribute(match[2] ?? match[3] ?? match[4] ?? "");
    if (value === null || name.includes(":") || name === "style" || !hasOnlySafeCssResources(value)) return null;
    if (name === "xmlns" && value !== SVG_NAMESPACE) return null;
    if (RESOURCE_ATTRIBUTES.has(name) && !safeResource(value)) return null;
  }

  return svg;
}

export function previewIndexAfterMove(currentIndex, direction, length) {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(direction) || length <= 0) return -1;
  const next = currentIndex + Math.sign(direction);
  return next >= 0 && next < length ? next : currentIndex;
}
