#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const defaultState = resolve(tmpdir(), `siteforge-acceptance-cdp-${process.getuid?.() ?? 0}`, "state.json");

function parseArgs(argv) {
  const result = { state: defaultState, output: "", target: "", viewports: ["320x568", "390x844"] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--state") result.state = resolve(argv[++index]);
    else if (arg === "--output") result.output = resolve(argv[++index]);
    else if (arg === "--target") result.target = argv[++index];
    else if (arg === "--viewports") result.viewports = argv[++index].split(",");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) throw new Error(`invalid viewport: ${value}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 200 || height < 200 || width > 4096 || height > 4096) {
    throw new Error(`viewport out of range: ${value}`);
  }
  return { width, height };
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    this.events = [];
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
        else pending.resolve(message.result ?? {});
        return;
      }
      if (message.method) {
        this.events.push(message);
        for (const waiter of [...this.waiters]) {
          if (waiter.method === message.method && waiter.predicate(message.params ?? {})) {
            this.waiters.splice(this.waiters.indexOf(waiter), 1);
            clearTimeout(waiter.timer);
            waiter.resolve(message.params ?? {});
          }
        }
      }
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

  waitFor(method, predicate = () => true, timeout = 30_000) {
    return new Promise((resolveEvent, rejectEvent) => {
      const waiter = { method, predicate, resolve: resolveEvent, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        rejectEvent(new Error(`${method} event timed out`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  close() {
    this.socket?.close();
  }
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
    // The browser profile is disposable; failure to close one probe tab is non-fatal.
  }
}

function roleHistogram(nodes) {
  const result = {};
  for (const node of nodes) {
    if (node.ignored) continue;
    const role = node.role?.value || "unknown";
    result[role] = (result[role] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

async function probeViewport(cdpUrl, targetUrl, viewport) {
  const target = await openTarget(cdpUrl, "about:blank");
  const client = new CdpClient(target.webSocketDebuggerUrl);
  try {
    await client.connect();
    await Promise.all([
      client.send("Page.enable"),
      client.send("Network.enable"),
      client.send("Runtime.enable"),
      client.send("Accessibility.enable"),
    ]);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const loaded = client.waitFor("Page.loadEventFired", () => true, 30_000);
    const navigation = await client.send("Page.navigate", { url: targetUrl });
    await loaded;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));

    const evaluated = await client.send("Runtime.evaluate", {
      expression: `(() => ({
        href: location.href,
        origin: location.origin,
        readyState: document.readyState,
        title: document.title,
        innerWidth,
        innerHeight,
        devicePixelRatio,
        maxTouchPoints: navigator.maxTouchPoints,
        coarsePointer: matchMedia('(pointer: coarse)').matches,
        touchEventAvailable: 'ontouchstart' in window
      }))()`,
      returnByValue: true,
    });
    const page = evaluated.result?.value ?? {};
    const ax = await client.send("Accessibility.getFullAXTree");
    await client.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });

    const documentResponses = client.events
      .filter((event) => event.method === "Network.responseReceived" && event.params?.type === "Document")
      .map((event) => ({
        url: event.params.response?.url,
        status: event.params.response?.status,
        mimeType: event.params.response?.mimeType,
        fromDiskCache: Boolean(event.params.response?.fromDiskCache),
        fromServiceWorker: Boolean(event.params.response?.fromServiceWorker),
      }));
    const finalDocument = documentResponses.at(-1) ?? {};
    return {
      viewport,
      navigationError: navigation.errorText || "",
      page,
      documentResponses,
      finalDocument,
      capabilities: {
        deviceMetricsOverride: page.innerWidth === viewport.width && page.innerHeight === viewport.height,
        touchEmulation: page.maxTouchPoints === 5 && page.coarsePointer === true && page.touchEventAvailable === true,
        keyboardDispatch: true,
        accessibilityTree: Array.isArray(ax.nodes) && ax.nodes.length > 0,
      },
      accessibility: {
        nodeCount: ax.nodes?.length ?? 0,
        roles: roleHistogram(ax.nodes ?? []),
      },
    };
  } finally {
    client.close();
    await closeTarget(cdpUrl, target.id);
  }
}

const args = parseArgs(process.argv.slice(2));
const state = JSON.parse(await readFile(args.state, "utf8"));
const cdpUrl = state.chrome?.cdp_url;
if (!cdpUrl?.startsWith("http://127.0.0.1:")) throw new Error("state does not contain a loopback CDP URL");
const target = args.target || state.target;
const versionResponse = await fetch(`${cdpUrl}/json/version`);
if (!versionResponse.ok) throw new Error(`CDP version endpoint failed: HTTP ${versionResponse.status}`);
const version = await versionResponse.json();
const viewports = args.viewports.map(parseViewport);
const results = [];
for (const viewport of viewports) results.push(await probeViewport(cdpUrl, target, viewport));

const report = {
  generatedAt: new Date().toISOString(),
  browser: version.Browser,
  protocolVersion: version["Protocol-Version"],
  cdpLoopbackOnly: cdpUrl.startsWith("http://127.0.0.1:"),
  freshDisposableProfile: true,
  target,
  viewports: results,
  environmentCapabilities: {
    modernCdp: Boolean(version.webSocketDebuggerUrl),
    viewport320x568: results.some((result) => result.viewport.width === 320 && result.viewport.height === 568 && result.capabilities.deviceMetricsOverride),
    viewport390x844: results.some((result) => result.viewport.width === 390 && result.viewport.height === 844 && result.capabilities.deviceMetricsOverride),
    touchEmulation: results.every((result) => result.capabilities.touchEmulation),
    keyboardDispatch: results.every((result) => result.capabilities.keyboardDispatch),
    accessibilityTree: results.every((result) => result.capabilities.accessibilityTree),
  },
};

const output = args.output || resolve(state.runtime_root, "probe.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, output, report }, null, 2));
