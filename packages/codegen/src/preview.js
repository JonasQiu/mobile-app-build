import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PREVIEW_DIR = ".mobile-build-previews";
export const PREVIEW_MANIFEST = "manifest.json";

const DIRECTIONS = [
  {
    key: "editorial",
    title: "内容优先",
    description: "大标题、强层级和留白，适合先讲清价值再引导行动。",
    palette: ["#f4f1e8", "#15181c", "#ff6b4a", "#d8d1c2"],
  },
  {
    key: "immersive",
    title: "视觉叙事",
    description: "深色氛围、渐变焦点和分镜卡片，强化品牌记忆。",
    palette: ["#090b12", "#f7f7f2", "#a9ff57", "#6f5cff"],
  },
  {
    key: "workspace",
    title: "效率工作台",
    description: "信息密度更高、模块清晰，适合工具和业务操作场景。",
    palette: ["#edf2f4", "#172026", "#147d92", "#ffb703"],
  },
];

const PALETTE_VARIANTS = {
  editorial: [
    ["#f4f1e8", "#15181c", "#ff6b4a", "#d8d1c2"],
    ["#edf4f0", "#14211b", "#168c65", "#c8ddd2"],
    ["#f6efe7", "#281811", "#cf5c36", "#e3cdbb"],
  ],
  immersive: [
    ["#090b12", "#f7f7f2", "#a9ff57", "#6f5cff"],
    ["#0c1020", "#f4f6ff", "#5ee7ff", "#ef5da8"],
    ["#15100f", "#fff8ed", "#ffcb69", "#c75cff"],
  ],
  workspace: [
    ["#edf2f4", "#172026", "#147d92", "#ffb703"],
    ["#eef0f7", "#1b2140", "#4f67d9", "#ff8a5b"],
    ["#eff4ed", "#1b2a1f", "#3b8d5a", "#d6a431"],
  ],
};

function hashRequirement(requirement) {
  return createHash("sha256").update(String(requirement || "").trim()).digest("hex");
}

function escapeXml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cleanLine(value) {
  return String(value || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*|`/g, "")
    .trim();
}

function compact(value, max) {
  const text = cleanLine(value).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function extractPreviewCopy(requirement, spec) {
  const lines = String(spec || "")
    .split("\n")
    .map(cleanLine)
    .filter((line) => line.length >= 4 && !/^(WHEN|THEN|GIVEN|AND)\b/i.test(line));
  const title = compact(requirement, 34) || compact(lines[0], 34) || "新网站方案";
  const candidates = [...lines, ...String(requirement || "").split(/[。！？!?；;]/).map(cleanLine)]
    .filter((line) => line && line !== title);
  const unique = [...new Set(candidates.map((line) => compact(line, 42)))];
  return {
    title,
    subtitle: unique[0] || "围绕核心目标组织内容与交互",
    points: [unique[1] || "清晰呈现核心信息", unique[2] || "移动端优先体验", unique[3] || "关键操作路径明确"],
  };
}

function shiftedDirections(requirement, generation) {
  const digest = createHash("sha256").update(`${requirement}:${generation}`).digest();
  const offset = digest[0] % DIRECTIONS.length;
  return DIRECTIONS.map((_, index) => {
    const direction = DIRECTIONS[(index + offset) % DIRECTIONS.length];
    const variants = PALETTE_VARIANTS[direction.key];
    return { ...direction, palette: variants[(generation + index) % variants.length] };
  });
}

function editorialSvg(copy, direction, optionId) {
  const [background, ink, accent, soft] = direction.palette;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(direction.title)}网站预览</title><desc id="desc">${escapeXml(copy.title)}</desc>
  <rect width="1200" height="800" fill="${background}"/><rect x="44" y="38" width="1112" height="724" rx="34" fill="#ffffff" stroke="${soft}" stroke-width="2"/>
  <circle cx="92" cy="82" r="9" fill="${accent}"/><text x="118" y="90" fill="${ink}" font-family="Arial, sans-serif" font-size="19" font-weight="700">SITE CONCEPT</text>
  <text x="1036" y="91" fill="${ink}" font-family="Arial, sans-serif" font-size="15">${escapeXml(optionId.slice(-8))}</text>
  <text x="92" y="212" fill="${accent}" font-family="Arial, sans-serif" font-size="17" font-weight="700">${escapeXml(direction.title)} · 方案预览</text>
  <text x="92" y="286" fill="${ink}" font-family="Arial, sans-serif" font-size="48" font-weight="800">${escapeXml(copy.title)}</text>
  <text x="92" y="337" fill="#666a70" font-family="Arial, sans-serif" font-size="22">${escapeXml(copy.subtitle)}</text>
  <rect x="92" y="386" width="176" height="52" rx="26" fill="${ink}"/><text x="136" y="419" fill="#fff" font-family="Arial, sans-serif" font-size="17" font-weight="700">开始探索 →</text>
  <rect x="92" y="510" width="300" height="160" rx="22" fill="${background}"/><rect x="420" y="510" width="300" height="160" rx="22" fill="${background}"/><rect x="748" y="510" width="300" height="160" rx="22" fill="${background}"/>
  ${copy.points.map((point, index) => `<circle cx="${126 + index * 328}" cy="552" r="12" fill="${accent}"/><text x="${112 + index * 328}" y="606" fill="${ink}" font-family="Arial, sans-serif" font-size="19" font-weight="700">0${index + 1}</text><text x="${112 + index * 328}" y="640" fill="#666a70" font-family="Arial, sans-serif" font-size="15">${escapeXml(compact(point, 20))}</text>`).join("")}
</svg>`;
}

function immersiveSvg(copy, direction, optionId) {
  const [background, ink, accent, violet] = direction.palette;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" role="img" aria-labelledby="title desc">
  <defs><radialGradient id="glow"><stop stop-color="${violet}" stop-opacity=".75"/><stop offset="1" stop-color="${background}" stop-opacity="0"/></radialGradient><linearGradient id="card" x2="1" y2="1"><stop stop-color="#1b2030"/><stop offset="1" stop-color="#10131d"/></linearGradient></defs>
  <title id="title">${escapeXml(direction.title)}网站预览</title><desc id="desc">${escapeXml(copy.title)}</desc>
  <rect width="1200" height="800" fill="${background}"/><circle cx="900" cy="160" r="350" fill="url(#glow)"/>
  <text x="68" y="78" fill="${ink}" font-family="Arial, sans-serif" font-size="18" font-weight="700">SITE CONCEPT</text><text x="1036" y="78" fill="${accent}" font-family="Arial, sans-serif" font-size="15">${escapeXml(optionId.slice(-8))}</text>
  <rect x="68" y="125" width="210" height="38" rx="19" fill="${accent}" fill-opacity=".14" stroke="${accent}" stroke-opacity=".5"/><text x="91" y="150" fill="${accent}" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escapeXml(direction.title)} · 方案预览</text>
  <text x="68" y="252" fill="${ink}" font-family="Arial, sans-serif" font-size="52" font-weight="800">${escapeXml(copy.title)}</text>
  <text x="68" y="310" fill="#aeb6c5" font-family="Arial, sans-serif" font-size="22">${escapeXml(copy.subtitle)}</text>
  <rect x="68" y="356" width="178" height="52" rx="26" fill="${accent}"/><text x="108" y="389" fill="${background}" font-family="Arial, sans-serif" font-size="17" font-weight="800">进入体验 →</text>
  ${copy.points.map((point, index) => `<g transform="translate(${68 + index * 362} 493)"><rect width="330" height="210" rx="26" fill="url(#card)" stroke="#30374a"/><text x="24" y="47" fill="${accent}" font-family="Arial, sans-serif" font-size="14" font-weight="700">0${index + 1}</text><text x="24" y="95" fill="${ink}" font-family="Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(compact(point, 20))}</text><rect x="24" y="126" width="210" height="10" rx="5" fill="#343b4d"/><rect x="24" y="150" width="154" height="10" rx="5" fill="#272d3c"/></g>`).join("")}
</svg>`;
}

function workspaceSvg(copy, direction, optionId) {
  const [background, ink, accent, signal] = direction.palette;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(direction.title)}网站预览</title><desc id="desc">${escapeXml(copy.title)}</desc>
  <rect width="1200" height="800" fill="${background}"/><rect x="30" y="28" width="1140" height="744" rx="30" fill="#fff" stroke="#d3dde1"/>
  <rect x="30" y="28" width="220" height="744" rx="30" fill="${ink}"/><circle cx="77" cy="77" r="14" fill="${signal}"/><text x="103" y="84" fill="#fff" font-family="Arial, sans-serif" font-size="18" font-weight="700">SITE CONCEPT</text>
  ${["概览", "核心内容", "服务模块", "行动入口"].map((label, index) => `<rect x="52" y="${142 + index * 62}" width="176" height="44" rx="12" fill="${index === 0 ? accent : "#ffffff"}" fill-opacity="${index === 0 ? ".9" : ".06"}"/><text x="72" y="${170 + index * 62}" fill="${index === 0 ? "#fff" : "#aab5bb"}" font-family="Arial, sans-serif" font-size="15">${label}</text>`).join("")}
  <text x="292" y="82" fill="${accent}" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escapeXml(direction.title)} · 方案预览</text><text x="1062" y="82" fill="#7b8b93" font-family="Arial, sans-serif" font-size="14">${escapeXml(optionId.slice(-8))}</text>
  <text x="292" y="162" fill="${ink}" font-family="Arial, sans-serif" font-size="42" font-weight="800">${escapeXml(copy.title)}</text><text x="292" y="207" fill="#64747c" font-family="Arial, sans-serif" font-size="20">${escapeXml(copy.subtitle)}</text>
  ${copy.points.map((point, index) => `<g transform="translate(${292 + index * 277} 262)"><rect width="250" height="138" rx="20" fill="${background}" stroke="#d6e0e4"/><circle cx="34" cy="34" r="12" fill="${index === 1 ? signal : accent}"/><text x="22" y="83" fill="${ink}" font-family="Arial, sans-serif" font-size="18" font-weight="700">${escapeXml(compact(point, 16))}</text><text x="22" y="111" fill="#72828a" font-family="Arial, sans-serif" font-size="13">核心模块 0${index + 1}</text></g>`).join("")}
  <rect x="292" y="444" width="806" height="252" rx="24" fill="#f8fafb" stroke="#d6e0e4"/><text x="322" y="489" fill="${ink}" font-family="Arial, sans-serif" font-size="17" font-weight="700">内容与操作总览</text>
  <rect x="322" y="524" width="486" height="18" rx="9" fill="#dce5e8"/><rect x="322" y="559" width="650" height="14" rx="7" fill="#e5ebee"/><rect x="322" y="588" width="580" height="14" rx="7" fill="#e5ebee"/><rect x="322" y="627" width="150" height="44" rx="12" fill="${accent}"/><text x="358" y="655" fill="#fff" font-family="Arial, sans-serif" font-size="15" font-weight="700">确认行动</text>
</svg>`;
}

function renderSvg(direction, copy, optionId) {
  if (direction.key === "immersive") return immersiveSvg(copy, direction, optionId);
  if (direction.key === "workspace") return workspaceSvg(copy, direction, optionId);
  return editorialSvg(copy, direction, optionId);
}

export async function generatePreviewSet({ outDir, requirement, spec, generation }) {
  const previewRoot = join(outDir, PREVIEW_DIR);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(join(previewRoot, PREVIEW_MANIFEST), "utf8"));
  } catch {
    previous = null;
  }
  const revision = Number.isInteger(generation) ? generation : Math.max(1, Number(previous?.revision || 0) + 1);
  await rm(previewRoot, { recursive: true, force: true });
  await mkdir(previewRoot, { recursive: true });
  const setId = `set_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const copy = extractPreviewCopy(requirement, spec);
  const directions = shiftedDirections(requirement, revision);
  const options = await Promise.all(directions.map(async (direction, index) => {
    const id = `${setId}_p${index + 1}`;
    const file = `preview-${index + 1}.svg`;
    await writeFile(join(previewRoot, file), `${renderSvg(direction, copy, id)}\n`, "utf8");
    return { id, file, title: direction.title, description: direction.description, palette: direction.palette };
  }));
  const manifest = {
    schemaVersion: 1,
    requirementHash: hashRequirement(requirement),
    setId,
    generatedAt: new Date().toISOString(),
    revision,
    options,
  };
  await writeFile(join(previewRoot, PREVIEW_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function readPreviewSet({ outDir, requirement }) {
  try {
    const manifest = JSON.parse(await readFile(join(outDir, PREVIEW_DIR, PREVIEW_MANIFEST), "utf8"));
    if (manifest?.requirementHash !== hashRequirement(requirement) || !manifest?.setId || !Array.isArray(manifest.options) || manifest.options.length < 2) return null;
    for (const option of manifest.options) {
      if (!option?.id || !/^preview-[1-9]\d*\.svg$/.test(String(option.file || ""))) return null;
      const svg = await readFile(join(outDir, PREVIEW_DIR, option.file), "utf8");
      if (!svg.startsWith("<svg") || !svg.includes("</svg>")) return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

export async function readPreviewArtifacts({ outDir, requirement }) {
  const manifest = await readPreviewSet({ outDir, requirement });
  if (!manifest) return [];
  return Promise.all(manifest.options.map(async (option) => ({
    name: option.file,
    label: option.title,
    description: option.description,
    id: option.id,
    setId: manifest.setId,
    format: "svg",
    content: await readFile(join(outDir, PREVIEW_DIR, option.file), "utf8"),
  })));
}

export async function validatePreviewApproval({ outDir, requirement, previewId }) {
  const manifest = await readPreviewSet({ outDir, requirement });
  if (!manifest) return false;
  return manifest.options.some((option) => option.id === previewId);
}

export async function readApprovedPreview({ outDir, requirement, previewId }) {
  const manifest = await readPreviewSet({ outDir, requirement });
  if (!manifest) return null;
  const option = manifest.options.find((item) => item.id === previewId);
  return option ? { setId: manifest.setId, ...option } : null;
}
