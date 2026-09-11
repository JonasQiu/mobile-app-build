#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const runtimeRoot = resolve(tmpdir(), `siteforge-acceptance-cdp-${process.getuid?.() ?? 0}`);
const statePath = resolve(runtimeRoot, "state.json");
const evidenceRoot = resolve("docs/evidence");
const outputPath = resolve(evidenceRoot, "preview-final-p0-c2b6bd3-browser.json");

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.socket = null;
    this.onEvent = null;
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      if (!message.method) return;
      this.events.push(message);
      void this.onEvent?.(message.method, message.params ?? {});
    });
    await new Promise((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => rejectOpen(new Error("CDP websocket open timed out")), 10_000);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timer); rejectOpen(new Error("CDP websocket failed")); }, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectResult(new Error(`${method} timed out`));
      }, 30_000);
      this.pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timer); resolveResult(value); },
        reject: (error) => { clearTimeout(timer); rejectResult(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

function assertResult(results, id, condition, actual, expected) {
  results.push({ id, status: condition ? "pass" : "fail", actual, expected });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function safeSvg(title, accent, subtitle) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" role="img" aria-labelledby="title desc"><title id="title">${title}</title><desc id="desc">${subtitle}方向评审图</desc><rect width="1440" height="900" fill="#0b1015"/><rect x="80" y="70" width="1280" height="760" rx="42" fill="#141d25" stroke="${accent}" stroke-width="4"/><circle cx="145" cy="135" r="18" fill="${accent}"/><text x="185" y="150" fill="#f4f7f8" font-family="sans-serif" font-size="46" font-weight="700">${title}</text><text x="120" y="250" fill="${accent}" font-family="sans-serif" font-size="28">${subtitle}</text><rect x="120" y="310" width="760" height="70" rx="18" fill="#273440"/><rect x="120" y="420" width="560" height="44" rx="14" fill="#273440"/><rect x="120" y="495" width="680" height="44" rx="14" fill="#273440"/><rect x="940" y="300" width="330" height="360" rx="30" fill="${accent}" opacity=".9"/><text x="1000" y="500" fill="#0b1015" font-family="sans-serif" font-size="34" font-weight="700">立即报名</text><rect x="120" y="690" width="1160" height="2" fill="#394853"/><text x="120" y="760" fill="#c7d0d8" font-family="sans-serif" font-size="24">当前批次安全 SVG · 无外部资源</text></svg>`;
}

function unsafeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900"><image href="https://external.invalid/p0-probe.png" width="10" height="10"/><rect width="1440" height="900" fill="#fff"/></svg>`;
}

function artifactsFor(batch) {
  const suffix = String(batch);
  const items = [
    ["a", `方向 A${suffix} · 清晰秩序`, "活动报名", "#a9ff57", "清晰秩序"],
    ["b", `方向 B${suffix} · 轻盈编辑`, "周末创作营", "#73a9ff", "轻盈编辑"],
    ["c", `方向 C${suffix} · 鲜明行动`, "城市探索", "#ffc760", "鲜明行动"],
  ];
  return items.map(([key, label, title, accent, subtitle], index) => ({
    id: `set-${suffix}-${key}`,
    setId: `set-${suffix}`,
    name: `preview-${suffix}-${key}.svg`,
    label,
    description: `${subtitle}；批次 ${suffix} 的稳定方向 ${index + 1}`,
    format: "svg",
    content: batch === 2 && key === "b" ? unsafeSvg() : safeSvg(title, accent, subtitle),
  }));
}

function projectRecord() {
  return {
    id: "final-preview-p0",
    name: "最终预览 P0 独立验收",
    prompt: "做一个可访问的活动报名网站",
    status: "awaiting_approval",
    currentStage: "preview",
    previewUrl: null,
    updatedAt: "2026-09-12T00:00:00.000+08:00",
    executionProgress: 56,
    executionMessage: "预览已就绪，等待确认",
    executionCheckpoints: ["mobile-spec", "preview"],
    previewApprovalStatus: "pending",
    selectedPreviewId: null,
  };
}

async function openTarget(cdpUrl, target) {
  const response = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(target)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`create target failed: HTTP ${response.status}`);
  return response.json();
}

async function closeTarget(cdpUrl, targetId) {
  try {
    await fetch(`${cdpUrl}/json/close/${targetId}`);
  } catch {
    // The isolated profile is disposable and is stopped by the owning surface command.
  }
}

const state = JSON.parse(await readFile(statePath, "utf8"));
const cdpUrl = state.chrome?.cdp_url;
const targetUrl = state.local_production?.url || state.target;
if (!cdpUrl?.startsWith("http://127.0.0.1:")) throw new Error("acceptance CDP URL is not loopback");
if (!targetUrl?.startsWith("http://127.0.0.1:")) throw new Error("local production URL is not loopback");

const version = await fetch(`${cdpUrl}/json/version`).then((response) => response.json());
const target = await openTarget(cdpUrl, "about:blank");
const client = new CdpClient(target.webSocketDebuggerUrl);
const results = [];
const network = [];
const apiCalls = [];
const touchTrace = [];
let batch = 1;
let approvalCalls = 0;
let approvedPreviewId = "";
let jobCalls = 0;

function jsonResponse(payload, status = 200) {
  return {
    responseCode: status,
    responseHeaders: [
      { name: "content-type", value: "application/json; charset=utf-8" },
      { name: "cache-control", value: "no-store" },
    ],
    body: Buffer.from(JSON.stringify(payload)).toString("base64"),
  };
}

await client.connect();
client.onEvent = async (method, params) => {
  if (method === "Network.requestWillBeSent") {
    network.push({ url: params.request?.url || "", method: params.request?.method || "", type: params.type || "" });
    return;
  }
  if (method !== "Fetch.requestPaused") return;
  const request = params.request;
  const url = new URL(request.url);
  try {
    if (url.hostname === "external.invalid" || url.hostname === "example.invalid") {
      network.push({ url: request.url, method: request.method, type: "blocked-external-probe" });
      await client.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204 });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      apiCalls.push({ path: url.pathname, method: request.method, postData: request.postData || "" });
    }
    if (url.pathname === "/api/auth/session") {
      await client.send("Fetch.fulfillRequest", { requestId: params.requestId, ...jsonResponse({ user: { id: "acceptance-user", username: "Independent Acceptance" } }) });
      return;
    }
    if (url.pathname === "/api/projects" && request.method === "GET") {
      await client.send("Fetch.fulfillRequest", { requestId: params.requestId, ...jsonResponse({ projects: [projectRecord()], executionCapacity: { active: 0, max: 2 } }) });
      return;
    }
    if (url.pathname === "/api/v1/projects/final-preview-p0/artifacts/preview" && request.method === "GET") {
      await client.send("Fetch.fulfillRequest", { requestId: params.requestId, ...jsonResponse({ stage: "preview", checkpointed: true, artifacts: artifactsFor(batch) }) });
      return;
    }
    if (url.pathname === "/api/v1/projects/final-preview-p0/preview-approval" && request.method === "POST") {
      approvalCalls += 1;
      const body = JSON.parse(request.postData || "{}");
      approvedPreviewId = body.previewId || "";
      const currentIds = new Set(artifactsFor(batch).map((item) => item.id));
      const approved = currentIds.has(approvedPreviewId) && batch === 3;
      await client.send("Fetch.fulfillRequest", { requestId: params.requestId, ...jsonResponse(approved ? { approved: true, selectedPreviewId: approvedPreviewId } : { approved: false, error: "stale or invalid preview" }, approved ? 200 : 409) });
      return;
    }
    if (url.pathname === "/api/v1/projects/final-preview-p0/jobs" && request.method === "POST") {
      jobCalls += 1;
      const body = JSON.parse(request.postData || "{}");
      if (body.regeneratePreview) {
        batch += 1;
        await client.send("Fetch.fulfillRequest", { requestId: params.requestId, ...jsonResponse({ job: { id: `preview-job-${batch}`, status: "awaiting_approval", currentStage: "preview", progress: 56, message: "新批次预览已就绪", checkpoints: ["mobile-spec", "preview"] } }) });
      } else {
        await client.send("Fetch.fulfillRequest", { requestId: params.requestId, ...jsonResponse({ job: { id: "implementation-job", status: "building", currentStage: "implementation", progress: 4, message: "已通过原确认入口进入实现", checkpoints: ["mobile-spec", "preview"] } }) });
      }
      return;
    }
    await client.send("Fetch.continueRequest", { requestId: params.requestId });
  } catch (error) {
    await client.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Failed" }).catch(() => {});
    throw error;
  }
};

async function evaluate(expression) {
  const response = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Runtime evaluation failed");
  return response.result?.value;
}

async function waitFor(expression, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`timed out waiting for ${expression}`);
}

async function setViewport(width, height, mobile = true) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
  await delay(120);
}

async function pointFor(selector) {
  const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; element.scrollIntoView({ block: "center", inline: "center" }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height }; })()`);
  if (!point) throw new Error(`missing selector: ${selector}`);
  return point;
}

async function mouseClick(selector) {
  const point = await pointFor(selector);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await delay(80);
  return point;
}

async function touchTap(selector) {
  await pointFor(selector);
  await delay(180);
  const point = await pointFor(selector);
  const before = await evaluate(`(() => { const hit=document.elementFromPoint(${point.x},${point.y}); const target=document.querySelector(${JSON.stringify(selector)}); return {selector:${JSON.stringify(selector)},hitTag:hit?.tagName,hitClass:hit?.className,hitName:hit?.getAttribute('aria-label')||hit?.textContent?.trim().replace(/\\s+/g,' ').slice(0,80),targetDisabled:Boolean(target?.disabled)}; })()`);
  await client.send("Page.bringToFront");
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5, configuration: "mobile" });
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }] });
  await delay(80);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(120);
  touchTrace.push({ ...before, point, after: await evaluate("({activeName:document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent?.trim().replace(/\\s+/g,' ').slice(0,80),dialogPresent:Boolean(document.querySelector('.immersive-preview-dialog')),index:document.querySelector('.immersive-preview-identity span')?.textContent})") });
  return point;
}

async function key(keyValue, code = keyValue, modifiers = 0) {
  const virtualCodes = { Enter: 13, " ": 32, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowRight: 39 };
  const windowsVirtualKeyCode = virtualCodes[keyValue] || 0;
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyValue, code, modifiers, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, text: keyValue === "Enter" ? "\r" : "" });
  if (keyValue === " ") await client.send("Input.dispatchKeyEvent", { type: "char", key: keyValue, code, modifiers, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode, text: " ", unmodifiedText: " " });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyValue, code, modifiers, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
  await delay(80);
}

async function screenshot(name) {
  const capture = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const path = resolve(evidenceRoot, name);
  await writeFile(path, Buffer.from(capture.data, "base64"));
  return path;
}

function axProperty(node, name) {
  return node.properties?.find((property) => property.name === name)?.value?.value;
}

try {
  await Promise.all([
    client.send("Page.enable"),
    client.send("Network.enable"),
    client.send("Runtime.enable"),
    client.send("Accessibility.enable"),
  ]);
  await client.send("Network.setExtraHTTPHeaders", { headers: {
    "oai-authenticated-user-id": "independent-acceptance-user",
    "oai-authenticated-user-email": "acceptance@example.test",
    "oai-authenticated-user-full-name": "Independent%20Acceptance",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  } });
  await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5, configuration: "mobile" });
  await setViewport(1280, 900, false);
  await client.send("Page.navigate", { url: targetUrl });
  await waitFor("document.readyState === 'complete'");
  await waitFor("Boolean(document.querySelector('.topbar .icon-button'))");
  await mouseClick(".topbar .icon-button");
  await waitFor("Boolean(document.querySelector('.project-open'))");
  await mouseClick(".project-open");
  await waitFor("document.querySelectorAll('.preview-option').length === 3");
  await waitFor("[...document.querySelectorAll('.preview-option-actions button:last-child')].every((button) => !button.disabled)");

  const initialBatch = await evaluate(`({
    cards: [...document.querySelectorAll('.preview-option')].map((card) => ({ label: card.querySelector('b')?.textContent, selected: card.classList.contains('selected') })),
    confirmDisabled: document.querySelector('.preview-actions .primary-button')?.disabled,
    approvalCalls: 0
  })`);
  assertResult(results, "current-batch-three-stable-directions", initialBatch.cards.length === 3 && initialBatch.cards.every((item) => /方向 [ABC]1/.test(item.label || "")) && initialBatch.cards.every((item) => !item.selected), initialBatch, "three current-batch directions, none selected");
  assertResult(results, "browse-without-selection-confirm-disabled", initialBatch.confirmDisabled === true && approvalCalls === 0, { confirmDisabled: initialBatch.confirmDisabled, approvalCalls }, { confirmDisabled: true, approvalCalls: 0 });

  await mouseClick(".preview-option:nth-child(2) .preview-option-actions button:first-child");
  await waitFor("Boolean(document.querySelector('.immersive-preview-dialog'))");
  await waitFor("document.activeElement?.getAttribute('aria-label') === '关闭沉浸预览'");
  await waitFor("!document.querySelector('.immersive-preview-select').disabled");
  const opened = await evaluate(`(() => {
    const dialog = document.querySelector('.immersive-preview-dialog');
    const img = dialog.querySelector('img');
    const canvas = dialog.querySelector('.preview-device-canvas');
    return {
      role: dialog.getAttribute('role'), modal: dialog.getAttribute('aria-modal'), labelledby: dialog.getAttribute('aria-labelledby'), describedby: dialog.getAttribute('aria-describedby'),
      title: dialog.querySelector('#immersive-preview-title')?.textContent, index: dialog.querySelector('.immersive-preview-identity span')?.textContent,
      device: dialog.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent, disclaimer: dialog.querySelector('#immersive-preview-disclaimer')?.textContent,
      focus: document.activeElement?.getAttribute('aria-label'), backgroundInert: document.querySelector('.app-content')?.hasAttribute('inert'),
      selectedCards: document.querySelectorAll('.preview-option.selected').length, canvasRatio: canvas.getBoundingClientRect().width / canvas.getBoundingClientRect().height,
      naturalRatio: img.naturalWidth / img.naturalHeight, objectFit: getComputedStyle(img).objectFit, approvalCalls: 0
    };
  })()`);
  assertResult(results, "open-second-default-desktop-no-auto-select", opened.title?.includes("方向 B1") && opened.index === "2/3" && opened.device?.includes("1440 × 900") && opened.selectedCards === 0 && approvalCalls === 0, opened, "direction B1, 2/3, desktop 1440x900, no selection or approval");
  assertResult(results, "dialog-semantics-disclaimer-inert", opened.role === "dialog" && opened.modal === "true" && opened.labelledby === "immersive-preview-title" && opened.describedby?.includes("immersive-preview-disclaimer") && opened.disclaimer?.includes("评审图不是最终页面") && opened.focus === "关闭沉浸预览" && opened.backgroundInert === true, opened, "named modal dialog, persistent disclaimer, inert background, focus inside");
  assertResult(results, "svg-complete-aspect", opened.objectFit === "contain" && Math.abs(opened.canvasRatio - 1.6) < 0.02 && Math.abs(opened.naturalRatio - 1.6) < 0.02, { canvasRatio: opened.canvasRatio, naturalRatio: opened.naturalRatio, objectFit: opened.objectFit }, "object-fit contain and 1440:900 ratio");

  await key("Tab", "Tab", 8);
  await waitFor("document.activeElement?.classList.contains('immersive-preview-select')");
  const shiftWrap = await evaluate("({inside: document.querySelector('.immersive-preview-dialog').contains(document.activeElement), className: document.activeElement.className})");
  await key("Tab", "Tab");
  await waitFor("document.activeElement?.getAttribute('aria-label') === '关闭沉浸预览'");
  const focusOrder = [];
  for (let index = 0; index < 7; index += 1) {
    focusOrder.push(await evaluate(`({ inside: document.querySelector('.immersive-preview-dialog').contains(document.activeElement), name: document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim().replace(/\\s+/g,' ').slice(0,80) })`));
    await key("Tab", "Tab");
  }
  assertResult(results, "tab-shifttab-focus-trap", shiftWrap.inside && focusOrder.every((item) => item.inside) && focusOrder[0].name === "关闭沉浸预览" && focusOrder.at(-1).name?.includes("选择此方案"), { shiftWrap, focusOrder }, "Shift+Tab wraps to select; seven controls remain in dialog in visual order");

  await evaluate("document.querySelector('.preview-device-controls button:nth-child(2)').focus()");
  await key("Enter", "Enter");
  await waitFor("document.querySelector('.preview-device-controls button:nth-child(2)').getAttribute('aria-pressed') === 'true'");
  await evaluate("document.querySelector('.preview-device-controls button:nth-child(3)').focus()");
  await key(" ", "Space");
  await waitFor("document.querySelector('.preview-device-controls button:nth-child(3)').getAttribute('aria-pressed') === 'true'");
  const canvasKeyboard = await evaluate(`({ current: document.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent, caption: document.querySelector('.preview-canvas-caption')?.textContent, selected: document.querySelectorAll('.preview-option.selected').length })`);
  assertResult(results, "three-canvases-keyboard-and-continuity", canvasKeyboard.current?.includes("390 × 844") && canvasKeyboard.caption?.includes("390 × 844") && canvasKeyboard.selected === 0, canvasKeyboard, "tablet then mobile via Enter/Space; no selection");

  await key("ArrowLeft", "ArrowLeft");
  await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '1/3'");
  await key("ArrowLeft", "ArrowLeft");
  const firstBoundary = await evaluate(`({ index: document.querySelector('.immersive-preview-identity span')?.textContent, previousDisabled: document.querySelector('.immersive-preview-navigation button:first-child')?.disabled, device: document.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent, selected: document.querySelectorAll('.preview-option.selected').length })`);
  await key("ArrowRight", "ArrowRight");
  await key("ArrowRight", "ArrowRight");
  await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '3/3'");
  await key("ArrowRight", "ArrowRight");
  const thirdBoundary = await evaluate(`({ index: document.querySelector('.immersive-preview-identity span')?.textContent, nextDisabled: document.querySelector('.immersive-preview-navigation button:last-child')?.disabled, device: document.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent, selected: document.querySelectorAll('.preview-option.selected').length })`);
  assertResult(results, "arrow-navigation-boundaries-no-selection", firstBoundary.index === "1/3" && firstBoundary.previousDisabled && thirdBoundary.index === "3/3" && thirdBoundary.nextDisabled && firstBoundary.device?.includes("390 × 844") && thirdBoundary.device?.includes("390 × 844") && firstBoundary.selected === 0 && thirdBoundary.selected === 0 && approvalCalls === 0, { firstBoundary, thirdBoundary, approvalCalls }, "non-cyclic 1/3 and 3/3 boundaries, canvas retained, no selection/approval");

  await key("ArrowLeft", "ArrowLeft");
  await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '2/3'");
  await evaluate(`(() => { const input=document.createElement('input'); input.id='p0-text-entry'; document.querySelector('.immersive-preview-dialog').append(input); input.focus(); })()`);
  await key("ArrowRight", "ArrowRight");
  const textEntryGuard = await evaluate(`({ index: document.querySelector('.immersive-preview-identity span')?.textContent, focused: document.activeElement?.id })`);
  await evaluate("document.querySelector('#p0-text-entry')?.remove()");
  assertResult(results, "arrow-text-entry-guard", textEntryGuard.index === "2/3" && textEntryGuard.focused === "p0-text-entry", textEntryGuard, "ArrowRight ignored in text input");

  await mouseClick(".immersive-preview-select");
  const selectedSecond = await evaluate(`({ text: document.querySelector('.immersive-preview-select')?.textContent, pressed: document.querySelector('.immersive-preview-select')?.getAttribute('aria-pressed'), selectedCount: document.querySelectorAll('.preview-option.selected').length, secondSelected: document.querySelector('.preview-option:nth-child(2)').classList.contains('selected'), announcement: document.querySelector('.immersive-preview-dialog .sr-only[aria-live]')?.textContent })`);
  assertResult(results, "select-second-single-source-not-confirmed", selectedSecond.pressed === "true" && selectedSecond.selectedCount === 1 && selectedSecond.secondSelected && selectedSecond.text?.includes("尚未最终确认") && selectedSecond.announcement?.includes("尚未最终确认") && approvalCalls === 0, { ...selectedSecond, approvalCalls }, "only direction 2 selected; announced as not finally confirmed; no approval call");

  await key("ArrowRight", "ArrowRight");
  await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '3/3'");
  await key("Escape", "Escape");
  await waitFor("!document.querySelector('.immersive-preview-dialog')");
  await delay(500);
  const escaped = await evaluate(`({ returnedToSecondTrigger: document.activeElement === document.querySelector('.preview-option:nth-child(2) .preview-option-actions button:first-child'), activeTag:document.activeElement?.tagName, activeClass:document.activeElement?.className, activeName:document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent?.trim().replace(/\\s+/g,' ').slice(0,80), selectedCount: document.querySelectorAll('.preview-option.selected').length, secondSelected: document.querySelector('.preview-option:nth-child(2)').classList.contains('selected'), backgroundInert: document.querySelector('.app-content')?.hasAttribute('inert') })`);
  assertResult(results, "escape-return-and-selection-retention", escaped.returnedToSecondTrigger && escaped.selectedCount === 1 && escaped.secondSelected && !escaped.backgroundInert, escaped, "Esc closes, focus returns to direction 2 trigger, selection remains, background restored");

  await mouseClick(".preview-option:nth-child(3) .preview-option-actions button:first-child");
  await waitFor("!document.querySelector('.immersive-preview-select').disabled");
  await evaluate("document.querySelector('.immersive-preview-select').focus()");
  await key(" ", "Space");
  await waitFor("document.querySelector('.preview-option:nth-child(3)').classList.contains('selected')");
  await mouseClick(".immersive-preview-identity button");
  await waitFor("!document.querySelector('.immersive-preview-dialog')");
  await delay(500);
  const replacedSelection = await evaluate(`({ selectedCount: document.querySelectorAll('.preview-option.selected').length, thirdSelected: document.querySelector('.preview-option:nth-child(3)').classList.contains('selected'), returnedToThirdTrigger: document.activeElement === document.querySelector('.preview-option:nth-child(3) .preview-option-actions button:first-child'), activeTag:document.activeElement?.tagName, activeClass:document.activeElement?.className, activeName:document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent?.trim().replace(/\\s+/g,' ').slice(0,80) })`);
  assertResult(results, "replace-unique-selection-and-explicit-close", replacedSelection.selectedCount === 1 && replacedSelection.thirdSelected && replacedSelection.returnedToThirdTrigger && approvalCalls === 0, { ...replacedSelection, approvalCalls }, "only direction 3 selected; explicit close returns to direction 3 trigger; no approval");

  await setViewport(390, 844, true);
  await evaluate(`(() => { window.__p0TouchEvents=[]; for (const type of ['pointerdown','touchstart','touchend','click']) document.addEventListener(type,(event)=>window.__p0TouchEvents.push({type,target:event.target?.getAttribute?.('aria-label')||event.target?.textContent?.trim().replace(/\\s+/g,' ').slice(0,60)||event.target?.tagName,pointerType:event.pointerType||'',trusted:event.isTrusted}),true); })()`);
  await touchTap(".preview-option:nth-child(1) .preview-option-actions button:first-child");
  await waitFor("Boolean(document.querySelector('.immersive-preview-dialog'))");
  const touchOpenIndex = await evaluate("document.querySelector('.immersive-preview-identity span')?.textContent");
  const touchNavigationSelector = touchOpenIndex === "3/3" ? ".immersive-preview-navigation button:first-child" : ".immersive-preview-navigation button:last-child";
  const expectedTouchIndex = touchOpenIndex === "3/3" ? "2/3" : touchOpenIndex === "1/3" ? "2/3" : "3/3";
  await touchTap(touchNavigationSelector);
  const touchNavigated = await evaluate(`document.querySelector('.immersive-preview-identity span')?.textContent === ${JSON.stringify(expectedTouchIndex)}`);
  if (!touchNavigated) await mouseClick(touchNavigationSelector);
  await waitFor(`document.querySelector('.immersive-preview-identity span')?.textContent === ${JSON.stringify(expectedTouchIndex)}`);
  await touchTap(".preview-device-controls button:nth-child(3)");
  const touchChangedCanvas = await evaluate("document.querySelector('.preview-device-controls button:nth-child(3)').getAttribute('aria-pressed') === 'true'");
  if (!touchChangedCanvas) await mouseClick(".preview-device-controls button:nth-child(3)");
  await waitFor("document.querySelector('.preview-device-controls button:nth-child(3)').getAttribute('aria-pressed') === 'true'");
  await touchTap(".immersive-preview-select");
  const touchSelected = await evaluate("document.querySelector('.immersive-preview-select').getAttribute('aria-pressed') === 'true'");
  if (!touchSelected) await mouseClick(".immersive-preview-select");
  await waitFor("document.querySelector('.immersive-preview-select').getAttribute('aria-pressed') === 'true'");
  const layout390 = await evaluate(`(() => { const dialog=document.querySelector('.immersive-preview-dialog'); const buttons=[...dialog.querySelectorAll('button')].map((button)=>({name:button.getAttribute('aria-label')||button.textContent.trim().replace(/\\s+/g,' '), width:button.getBoundingClientRect().width, height:button.getBoundingClientRect().height})); const img=dialog.querySelector('img'); return { innerWidth, innerHeight, rootScrollWidth:document.documentElement.scrollWidth, bodyScrollWidth:document.body.scrollWidth, dialogClientWidth:dialog.clientWidth, dialogScrollWidth:dialog.scrollWidth, minButtonWidth:Math.min(...buttons.map((button)=>button.width)), minButtonHeight:Math.min(...buttons.map((button)=>button.height)), buttons, selectedCount:document.querySelectorAll('.preview-option.selected').length, currentIndex:dialog.querySelector('.immersive-preview-identity span')?.textContent, currentDevice:dialog.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent, naturalRatio:img?.naturalWidth/img?.naturalHeight, objectFit:img?getComputedStyle(img).objectFit:'' }; })()`);
  await evaluate("document.querySelector('.immersive-preview-dialog').scrollTop = 0");
  await delay(150);
  await screenshot("preview-final-p0-c2b6bd3-390x844.png");
  const touchEvents = await evaluate("window.__p0TouchEvents");
  assertResult(results, "cdp-touch-core-path-390x844", ["1/3","2/3","3/3"].includes(touchOpenIndex) && touchNavigated && touchChangedCanvas && touchSelected && touchEvents.some((event)=>event.type==='touchstart'&&event.trusted) && layout390.innerWidth === 390 && layout390.innerHeight === 844 && layout390.rootScrollWidth <= 390 && layout390.bodyScrollWidth <= 390 && layout390.dialogScrollWidth <= layout390.dialogClientWidth && layout390.minButtonWidth >= 44 && layout390.minButtonHeight >= 44 && layout390.selectedCount === 1 && layout390.currentIndex === expectedTouchIndex && layout390.currentDevice?.includes("390 × 844") && layout390.objectFit === "contain", { touchOpenIndex, expectedTouchIndex, touchNavigated, touchChangedCanvas, touchSelected, touchEvents, layout390 }, "trusted CDP touch opens a direction, navigates one step, switches canvas and selects at 390x844; no horizontal overflow; all dialog buttons >=44x44");

  await setViewport(320, 568, true);
  const stateBeforeResize = await evaluate(`({ index: document.querySelector('.immersive-preview-identity span')?.textContent, device: document.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent, selectedSecond: document.querySelector('.preview-option:nth-child(2)').classList.contains('selected') })`);
  const layout320 = await evaluate(`(() => { const dialog=document.querySelector('.immersive-preview-dialog'); const buttons=[...dialog.querySelectorAll('button')].map((button)=>({name:button.getAttribute('aria-label')||button.textContent.trim().replace(/\\s+/g,' '), width:button.getBoundingClientRect().width, height:button.getBoundingClientRect().height, top:button.getBoundingClientRect().top, bottom:button.getBoundingClientRect().bottom})); return { innerWidth, innerHeight, rootScrollWidth:document.documentElement.scrollWidth, bodyScrollWidth:document.body.scrollWidth, dialogClientWidth:dialog.clientWidth, dialogScrollWidth:dialog.scrollWidth, dialogClientHeight:dialog.clientHeight, dialogScrollHeight:dialog.scrollHeight, minButtonWidth:Math.min(...buttons.map((button)=>button.width)), minButtonHeight:Math.min(...buttons.map((button)=>button.height)), buttons }; })()`);
  await evaluate("document.querySelector('.immersive-preview-dialog').scrollTop = 0");
  await delay(150);
  await screenshot("preview-final-p0-c2b6bd3-320x568-top.png");
  await evaluate("document.querySelector('.immersive-preview-dialog').scrollTop = document.querySelector('.immersive-preview-dialog').scrollHeight");
  await delay(150);
  await screenshot("preview-final-p0-c2b6bd3-320x568-bottom.png");
  assertResult(results, "responsive-320x568-reachable-and-stateful", stateBeforeResize.index === "2/3" && stateBeforeResize.device?.includes("390 × 844") && stateBeforeResize.selectedSecond && layout320.innerWidth === 320 && layout320.innerHeight === 568 && layout320.rootScrollWidth <= 320 && layout320.bodyScrollWidth <= 320 && layout320.dialogScrollWidth <= layout320.dialogClientWidth && layout320.dialogScrollHeight > layout320.dialogClientHeight && layout320.minButtonWidth >= 44 && layout320.minButtonHeight >= 44, { stateBeforeResize, layout320 }, "state retained; vertical scroll reaches controls; no horizontal overflow; all targets >=44x44");

  await setViewport(844, 390, true);
  const landscape = await evaluate(`(() => { const dialog=document.querySelector('.immersive-preview-dialog'); return { innerWidth, innerHeight, rootScrollWidth:document.documentElement.scrollWidth, dialogScrollWidth:dialog.scrollWidth, dialogClientWidth:dialog.clientWidth, index:dialog.querySelector('.immersive-preview-identity span')?.textContent, device:dialog.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent, selectedSecond:document.querySelector('.preview-option:nth-child(2)').classList.contains('selected') }; })()`);
  assertResult(results, "orientation-resize-retains-state", landscape.innerWidth === 844 && landscape.innerHeight === 390 && landscape.rootScrollWidth <= 844 && landscape.dialogScrollWidth <= landscape.dialogClientWidth && landscape.index === "2/3" && landscape.device?.includes("390 × 844") && landscape.selectedSecond, landscape, "landscape resize keeps direction, canvas and selection without horizontal overflow");

  await setViewport(768, 1024, true);
  const tabletViewport = await evaluate(`(() => { const dialog=document.querySelector('.immersive-preview-dialog'); const img=dialog.querySelector('img'); return { innerWidth,innerHeight,rootScrollWidth:document.documentElement.scrollWidth,dialogScrollWidth:dialog.scrollWidth,dialogClientWidth:dialog.clientWidth,index:dialog.querySelector('.immersive-preview-identity span')?.textContent,device:dialog.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent,selectedSecond:document.querySelector('.preview-option:nth-child(2)').classList.contains('selected'),objectFit:getComputedStyle(img).objectFit,naturalRatio:img.naturalWidth/img.naturalHeight }; })()`);
  assertResult(results, "tablet-viewport-core-state", tabletViewport.innerWidth === 768 && tabletViewport.innerHeight === 1024 && tabletViewport.rootScrollWidth <= 768 && tabletViewport.dialogScrollWidth <= tabletViewport.dialogClientWidth && tabletViewport.index === "2/3" && tabletViewport.device?.includes("390 × 844") && tabletViewport.selectedSecond && tabletViewport.objectFit === "contain" && Math.abs(tabletViewport.naturalRatio-1.6)<0.02, tabletViewport, "768x1024 viewport preserves core path state, contains SVG and has no horizontal overflow");

  await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const reducedMotion = await evaluate(`(() => { const values=[...document.querySelectorAll('.immersive-preview-dialog button,.preview-option')].map((element)=>({animation:getComputedStyle(element).animationDuration,transition:getComputedStyle(element).transitionDuration})); return {matches:matchMedia('(prefers-reduced-motion: reduce)').matches,values}; })()`);
  const durations = reducedMotion.values.flatMap((item) => [item.animation, item.transition]).flatMap((value) => value.split(",")).map((value) => value.trim()).map((value) => value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000);
  assertResult(results, "reduced-motion", reducedMotion.matches && durations.every((value) => Number.isFinite(value) && value <= 0.02), reducedMotion, "all dialog animation/transition durations <=0.02ms under reduce");

  const contrast = await evaluate(`(() => {
    function rgba(value) { const m=value.match(/[\\d.]+/g)?.map(Number)||[]; return [m[0]||0,m[1]||0,m[2]||0,m.length>3?m[3]:1]; }
    function composite(fg,bg) { const a=fg[3]+bg[3]*(1-fg[3]); if(a===0)return [0,0,0,0]; return [(fg[0]*fg[3]+bg[0]*bg[3]*(1-fg[3]))/a,(fg[1]*fg[3]+bg[1]*bg[3]*(1-fg[3]))/a,(fg[2]*fg[3]+bg[2]*bg[3]*(1-fg[3]))/a,a]; }
    function background(element) { let color=[0,0,0,0]; for(let node=element;node;node=node.parentElement){ color=composite(rgba(getComputedStyle(node).backgroundColor),color); if(color[3]>=.999) break; } return color; }
    function lum(c){ const v=c.slice(0,3).map((x)=>{ x/=255; return x<=.04045?x/12.92:((x+.055)/1.055)**2.4; }); return .2126*v[0]+.7152*v[1]+.0722*v[2]; }
    function ratio(a,b){ const l1=lum(a),l2=lum(b); return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05); }
    const samples=[['title','#immersive-preview-title'],['description','#immersive-preview-description'],['disclaimer','#immersive-preview-disclaimer'],['device-label','.preview-device-controls button span'],['device-size','.preview-device-controls button small'],['navigation','.immersive-preview-navigation button:not(:disabled)'],['select','.immersive-preview-select']];
    return samples.map(([name,selector])=>{ const element=document.querySelector(selector); const fg=rgba(getComputedStyle(element).color); const bg=background(element); return {name,foreground:getComputedStyle(element).color,background:bg,ratio:ratio(fg,bg)}; });
  })()`);
  const minTextContrast = Math.min(...contrast.map((item) => item.ratio));
  assertResult(results, "text-control-contrast", minTextContrast >= 4.5, { minTextContrast, samples: contrast }, ">=4.5:1 for sampled dialog text and controls");

  const axTree = await client.send("Accessibility.getFullAXTree");
  const visibleAx = (axTree.nodes || []).filter((node) => !node.ignored);
  const dialogAx = visibleAx.find((node) => node.role?.value === "dialog");
  const buttonAx = visibleAx.filter((node) => node.role?.value === "button").map((node) => ({ name: node.name?.value || "", disabled: axProperty(node, "disabled"), pressed: axProperty(node, "pressed") }));
  const liveAx = visibleAx.filter((node) => axProperty(node, "live")).map((node) => ({ role: node.role?.value, name: node.name?.value || "", live: axProperty(node, "live"), atomic: axProperty(node, "atomic") }));
  const axSummary = { nodeCount: axTree.nodes?.length || 0, dialog: { name: dialogAx?.name?.value || "", description: dialogAx?.description?.value || "", modal: axProperty(dialogAx || {}, "modal") }, buttons: buttonAx, liveRegions: liveAx };
  assertResult(results, "chromium-accessibility-tree", Boolean(dialogAx?.name?.value?.includes("方向 B1")) && buttonAx.some((item) => item.name === "关闭沉浸预览") && buttonAx.some((item) => item.name.includes("手机") && item.pressed === "true") && buttonAx.some((item) => item.name.includes("选择") && item.pressed === "true") && liveAx.some((item) => item.live === "polite"), axSummary, "named dialog; named/pressed controls; polite live region in Chromium AX tree");

  await touchTap(".immersive-preview-identity button");
  const touchClosed = await evaluate("!document.querySelector('.immersive-preview-dialog')");
  if (!touchClosed) await key("Escape", "Escape");
  await waitFor("!document.querySelector('.immersive-preview-dialog')");
  assertResult(results, "cdp-touch-close", touchClosed, { touchClosed }, "trusted CDP touch closes immersive preview");
  const approvalBeforeRegenerate = approvalCalls;
  await mouseClick(".preview-actions .secondary-button");
  await waitFor("document.body.textContent.includes('方向 B2')");
  await waitFor("document.querySelectorAll('.preview-option').length === 3");
  const regenerated = await evaluate(`({ labels:[...document.querySelectorAll('.preview-option b')].map((item)=>item.textContent), selectedCount:document.querySelectorAll('.preview-option.selected').length, confirmDisabled:document.querySelector('.preview-actions .primary-button')?.disabled, failedCards:document.querySelectorAll('.preview-option.failed').length })`);
  assertResult(results, "regenerate-clears-old-state", regenerated.labels.every((label) => label.includes("2")) && regenerated.selectedCount === 0 && regenerated.confirmDisabled && regenerated.failedCards === 1 && approvalCalls === approvalBeforeRegenerate, { ...regenerated, approvalCalls }, "only batch 2 remains; old selection cleared; invalid direction failed; no approval");

  await setViewport(390, 844, true);
  await mouseClick(".preview-option:nth-child(2) .preview-option-actions button:first-child");
  await waitFor("Boolean(document.querySelector('.immersive-preview-state.failed'))");
  const failedPreview = await evaluate(`({ index:document.querySelector('.immersive-preview-identity span')?.textContent, alert:document.querySelector('.immersive-preview-state.failed')?.textContent, selectDisabled:document.querySelector('.immersive-preview-select')?.disabled, nextDisabled:document.querySelector('.immersive-preview-navigation button:last-child')?.disabled, previousDisabled:document.querySelector('.immersive-preview-navigation button:first-child')?.disabled, announcement:document.querySelector('.immersive-preview-dialog .sr-only[aria-live]')?.textContent })`);
  await evaluate("document.querySelector('.immersive-preview-state.failed').scrollIntoView({block:'center'})");
  await delay(150);
  await screenshot("preview-final-p0-c2b6bd3-load-failure.png");
  await key("ArrowLeft", "ArrowLeft");
  await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '1/3'");
  await waitFor("!document.querySelector('.immersive-preview-select').disabled");
  await key("ArrowRight", "ArrowRight");
  await key("ArrowRight", "ArrowRight");
  await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '3/3'");
  await waitFor("!document.querySelector('.immersive-preview-select').disabled");
  const externalRequests = network.filter((item) => item.url.includes("external.invalid") || item.url.includes("example.invalid"));
  assertResult(results, "unsafe-svg-fails-closed-and-navigation-recovers", failedPreview.index === "2/3" && failedPreview.alert?.includes("无法安全载入") && failedPreview.selectDisabled && !failedPreview.nextDisabled && !failedPreview.previousDisabled && externalRequests.length === 0, { failedPreview, externalRequests }, "unsafe SVG is readable failure, unselectable, adjacent safe directions work, no external request");

  await key("Escape", "Escape");
  await waitFor("!document.querySelector('.immersive-preview-dialog')");
  await mouseClick(".preview-actions .secondary-button");
  await waitFor("document.body.textContent.includes('方向 B3')");
  await delay(1_200);
  const batch3Readiness = await evaluate(`({ cards:[...document.querySelectorAll('.preview-option')].map((card)=>({label:card.querySelector('b')?.textContent,failed:card.classList.contains('failed'),selectDisabled:card.querySelector('.preview-option-actions button:last-child')?.disabled,loading:Boolean(card.querySelector('.preview-option-image > span')),imageComplete:card.querySelector('img')?.complete,naturalWidth:card.querySelector('img')?.naturalWidth})) })`);
  const batch3Ready = batch3Readiness.cards.length === 3 && batch3Readiness.cards.every((card) => !card.failed && !card.selectDisabled && !card.loading && card.imageComplete && card.naturalWidth > 0);
  assertResult(results, "regenerated-reused-svg-loads-ready", batch3Ready, batch3Readiness, "all regenerated safe SVGs, including reused content, leave loading state and become selectable");
  if (!batch3Ready) {
    await client.send("Page.reload", { ignoreCache: false });
    await waitFor("document.readyState === 'complete'");
    await waitFor("Boolean(document.querySelector('.topbar .icon-button'))");
    await mouseClick(".topbar .icon-button");
    await waitFor("Boolean(document.querySelector('.project-open'))");
    await mouseClick(".project-open");
    await waitFor("document.body.textContent.includes('方向 B3')");
    await waitFor("!document.querySelector('.preview-option:nth-child(2) .preview-option-actions button:last-child').disabled");
  }
  await mouseClick(".preview-option:nth-child(2) .preview-option-actions button:first-child");
  await waitFor("!document.querySelector('.immersive-preview-select').disabled");
  const rapidSequence = ["ArrowRight", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight"];
  for (const arrow of rapidSequence) {
    await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: arrow, code: arrow });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: arrow, code: arrow });
    await delay(20);
  }
  await delay(250);
  const rapid = await evaluate(`({ title:document.querySelector('#immersive-preview-title')?.textContent, index:document.querySelector('.immersive-preview-identity span')?.textContent, imageAlt:document.querySelector('.immersive-preview-stage img')?.alt, selectedCount:document.querySelectorAll('.preview-option.selected').length, failedState:Boolean(document.querySelector('.immersive-preview-state.failed')) })`);
  assertResult(results, "rapid-navigation-current-image-consistency", rapid.index === "3/3" && rapid.title?.includes("方向 C3") && rapid.imageAlt?.includes("方向 C3") && rapid.selectedCount === 0 && !rapid.failedState, rapid, "final index, title and image are batch 3 direction C with no stale selection/failure");

  await key("ArrowLeft", "ArrowLeft");
  await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '2/3'");
  await mouseClick(".immersive-preview-select");
  await key("Escape", "Escape");
  await waitFor("!document.querySelector('.immersive-preview-dialog')");
  const beforeConfirm = { approvalCalls, selected: await evaluate("document.querySelector('.preview-option:nth-child(2)').classList.contains('selected')"), confirmDisabled: await evaluate("document.querySelector('.preview-actions .primary-button').disabled") };
  assertResult(results, "all-preview-actions-isolated-from-approval", beforeConfirm.approvalCalls === 0 && beforeConfirm.selected && beforeConfirm.confirmDisabled === false, beforeConfirm, "open/navigation/canvas/select/close/regenerate make zero approval requests; original confirm enabled only after selection");
  await mouseClick(".preview-actions .primary-button");
  await waitFor("document.body.textContent.includes('任务已进入云端执行队列') || document.body.textContent.includes('已通过原确认入口进入实现')");
  const afterConfirm = { approvalCalls, approvedPreviewId, jobCalls, approvalRequests: apiCalls.filter((item) => item.path.endsWith("/preview-approval")), selectedBatch: batch };
  assertResult(results, "only-original-confirm-calls-approval", approvalCalls === 1 && approvedPreviewId === "set-3-b" && jobCalls === 3 && afterConfirm.approvalRequests.length === 1, afterConfirm, "one approval for current stable ID, followed by continue job; prior two jobs are explicit regenerations");

  await mkdir(evidenceRoot, { recursive: true });
  const report = {
    baseline: "c2b6bd391a764b7efc73105180d1a8a8d2dcb38f",
    businessBaseline: "2f178fae00cb49746b9ee24b924d35d1fa077c8d",
    generatedAt: new Date().toISOString(),
    browser: version.Browser,
    protocolVersion: version["Protocol-Version"],
    executionSurface: {
      loopbackCdp: true,
      localProduction: true,
      disposableIsolatedProfile: true,
      realLoginData: "unavailable; mock API responses only",
      cdpTouchEmulation: true,
      physicalTouch: "unavailable",
      chromiumAccessibilityTree: true,
      realVoiceOver: "unavailable",
      implementationEvidenceUsedAsAcceptanceEvidence: false,
    },
    summary: { pass: results.filter((item) => item.status === "pass").length, fail: results.filter((item) => item.status === "fail").length },
    results,
    screenshots: [
      "docs/evidence/preview-final-p0-c2b6bd3-390x844.png",
      "docs/evidence/preview-final-p0-c2b6bd3-320x568-top.png",
      "docs/evidence/preview-final-p0-c2b6bd3-320x568-bottom.png",
      "docs/evidence/preview-final-p0-c2b6bd3-load-failure.png",
    ],
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, output: outputPath, summary: report.summary, results: results.map(({ id, status }) => ({ id, status })) }, null, 2));
} catch (error) {
  const failed = {
    baseline: "c2b6bd391a764b7efc73105180d1a8a8d2dcb38f",
    generatedAt: new Date().toISOString(),
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    completedResults: results,
    touchTrace,
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(failed, null, 2)}\n`, "utf8");
  throw error;
} finally {
  client.close();
  await closeTarget(cdpUrl, target.id);
}
