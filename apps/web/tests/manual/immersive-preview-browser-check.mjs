import { writeFile } from "node:fs/promises";

const targets = await fetch("http://127.0.0.1:9223/json/list").then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("No blank Chrome target");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map();
const events = new Map();
ws.addEventListener("message", async ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result || {});
    return;
  }
  const waiters = events.get(message.method);
  if (waiters?.length) waiters.shift()(message.params || {});
  if (message.method === "Fetch.requestPaused") {
    const url = new URL(message.params.request.url);
    const project = {
      id: "browser-preview-project",
      name: "沉浸预览浏览器验收",
      prompt: "做一个可访问的活动报名网站",
      status: "awaiting_approval",
      currentStage: "preview",
      previewUrl: null,
      updatedAt: "2026-08-23T14:00:00.000Z",
      executionProgress: 56,
      executionMessage: "预览已就绪，等待确认",
      executionCheckpoints: ["mobile-spec", "preview"],
      previewApprovalStatus: "pending",
      selectedPreviewId: null,
    };
    const makeSvg = (title, accent, subtitle) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900"><rect width="1440" height="900" fill="#0b1015"/><rect x="80" y="70" width="1280" height="760" rx="42" fill="#141d25" stroke="${accent}" stroke-width="4"/><circle cx="145" cy="135" r="18" fill="${accent}"/><text x="185" y="150" fill="#f4f7f8" font-family="sans-serif" font-size="46" font-weight="700">${title}</text><text x="120" y="250" fill="${accent}" font-family="sans-serif" font-size="28">${subtitle}</text><rect x="120" y="310" width="760" height="70" rx="18" fill="#273440"/><rect x="120" y="420" width="560" height="44" rx="14" fill="#273440"/><rect x="120" y="495" width="680" height="44" rx="14" fill="#273440"/><rect x="940" y="300" width="330" height="360" rx="30" fill="${accent}" opacity=".9"/><text x="1000" y="500" fill="#0b1015" font-family="sans-serif" font-size="34" font-weight="700">立即报名</text><rect x="120" y="690" width="1160" height="2" fill="#394853"/><text x="120" y="760" fill="#9facb8" font-family="sans-serif" font-size="24">当前批次安全 SVG · 无外部资源</text></svg>`;
    const artifacts = [
      { id: "direction-a", setId: "set-current", name: "preview-a.svg", label: "方向 A · 清晰秩序", description: "信息层级清楚，强调内容与报名入口", format: "svg", content: makeSvg("活动报名", "#a9ff57", "清晰秩序") },
      { id: "direction-b", setId: "set-current", name: "preview-b.svg", label: "方向 B · 轻盈编辑", description: "更大的留白与轻量视觉节奏", format: "svg", content: makeSvg("周末创作营", "#73a9ff", "轻盈编辑") },
      { id: "direction-c", setId: "set-current", name: "preview-c.svg", label: "方向 C · 鲜明行动", description: "突出行动区和关键报名信息", format: "svg", content: makeSvg("城市探索", "#ffc760", "鲜明行动") },
    ];
    let payload = null;
    if (url.pathname === "/api/auth/session") payload = { user: { id: "browser-user", username: "Browser Acceptance" } };
    if (url.pathname === "/api/projects") payload = { projects: [project], executionCapacity: { active: 0, max: 2 } };
    if (url.pathname === "/api/v1/projects/browser-preview-project/artifacts/preview") payload = { stage: "preview", checkpointed: true, artifacts };
    if (payload) {
      const body = Buffer.from(JSON.stringify(payload)).toString("base64");
      await call("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }], body });
    } else {
      await call("Fetch.continueRequest", { requestId: message.params.requestId });
    }
  }
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
}
function once(method) {
  return new Promise((resolve) => {
    const list = events.get(method) || [];
    list.push(resolve);
    events.set(method, list);
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return result.result?.value;
}
async function waitFor(expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector) {
  const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
  if (!point) throw new Error(`Missing selector ${selector}`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}
async function screenshot(path) {
  const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(path, Buffer.from(shot.data, "base64"));
}

await call("Page.enable");
await call("Runtime.enable");
await call("Network.enable");
await call("Network.setExtraHTTPHeaders", { headers: { "oai-authenticated-user-id": "browser-evidence-user", "oai-authenticated-user-email": "browser-evidence@example.test", "oai-authenticated-user-full-name": "Browser%20Acceptance", "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8" } });
await call("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const loaded = once("Page.loadEventFired");
await call("Page.navigate", { url: "http://127.0.0.1:3000/" });
await loaded;
await waitFor("Boolean(document.querySelector('.topbar .icon-button'))");
await click(".topbar .icon-button");
await waitFor("Boolean(document.querySelector('.project-open'))");
await click(".project-open");
await waitFor("document.querySelectorAll('.preview-option').length === 3");
await click(".preview-option:nth-child(2) .preview-option-actions button:first-child");
await waitFor("Boolean(document.querySelector('.immersive-preview-dialog'))");
await waitFor("document.activeElement?.getAttribute('aria-label') === '关闭沉浸预览'");
const initial = await evaluate(`({ title: document.querySelector('#immersive-preview-title')?.textContent, index: document.querySelector('.immersive-preview-identity span')?.textContent, focus: document.activeElement?.getAttribute('aria-label'), device: document.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent })`);
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 8 });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", modifiers: 8 });
await waitFor("document.activeElement?.classList.contains('immersive-preview-select')");
const focusTrap = await evaluate(`({ shiftTabWrap: document.activeElement?.className })`);
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
await waitFor("document.activeElement?.getAttribute('aria-label') === '关闭沉浸预览'");
await click(".preview-device-controls button:nth-child(3)");
await waitFor("document.querySelector('.preview-device-controls button:nth-child(3)').getAttribute('aria-pressed') === 'true'");
await screenshot("docs/evidence/immersive-preview-390x844.png");
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft" });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft" });
await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '1/3'");
const afterLeft = await evaluate(`({ index: document.querySelector('.immersive-preview-identity span')?.textContent, device: document.querySelector('.preview-device-controls button[aria-pressed="true"]')?.textContent, selected: document.querySelectorAll('.preview-option.selected').length })`);
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
await waitFor("document.querySelector('.immersive-preview-identity span')?.textContent === '2/3'");
await waitFor("!document.querySelector('.immersive-preview-select').disabled");
await click(".immersive-preview-select");
const selection = await evaluate(`({ selectedText: document.querySelector('.immersive-preview-select')?.textContent, selectedCards: document.querySelectorAll('.preview-option.selected').length, selectedSecond: document.querySelector('.preview-option:nth-child(2)')?.classList.contains('selected') })`);
await call("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 1, mobile: true });
await new Promise((resolve) => setTimeout(resolve, 250));
const mobileLayout = await evaluate(`(() => { const d=document.querySelector('.immersive-preview-dialog'); const buttons=[...d.querySelectorAll('button')].map((b)=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,disabled:b.disabled})); return {innerWidth,rootScrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,dialogClientWidth:d.clientWidth,dialogScrollWidth:d.scrollWidth,dialogClientHeight:d.clientHeight,dialogScrollHeight:d.scrollHeight,minCoreButtonHeight:Math.min(...buttons.filter(b=>!b.disabled).map(b=>b.h))}; })()`);
await evaluate("document.querySelector('.immersive-preview-dialog').scrollTop = 0");
await new Promise((resolve) => setTimeout(resolve, 150));
await screenshot("docs/evidence/immersive-preview-320x568-top.png");
await evaluate("document.querySelector('.immersive-preview-dialog').scrollTop = document.querySelector('.immersive-preview-dialog').scrollHeight");
await new Promise((resolve) => setTimeout(resolve, 150));
await screenshot("docs/evidence/immersive-preview-320x568-bottom.png");
await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
await waitFor("!document.querySelector('.immersive-preview-dialog')");
await waitFor("document.activeElement === document.querySelector('.preview-option:nth-child(2) .preview-option-actions button:first-child')");
const closed = await evaluate(`({ focused: document.activeElement?.textContent?.slice(0, 40), selectedCards: document.querySelectorAll('.preview-option.selected').length, secondSelected: document.querySelector('.preview-option:nth-child(2)')?.classList.contains('selected'), confirmedCalls: performance.getEntriesByType('resource').filter((entry)=>entry.name.includes('preview-approval')).length })`);
console.log(JSON.stringify({ initial, focusTrap, afterLeft, selection, mobileLayout, closed }, null, 2));
ws.close();
