import { getD1 } from "./server-auth";

const PRIMARY_RUNNER_ID = "primary";
const RUNNER_HEARTBEAT_TTL_MS = 45_000;
const RUNNER_HEALTH_TIMEOUT_MS = 8_000;

type RunnerEndpointRow = {
  endpoint: string;
  instanceId: string | null;
  lastSeenAt: string;
  rotateRequestedAt: string | null;
};

function normalizeRunnerEndpoint(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const endpoint = new URL(value.trim());
    if (!['http:', 'https:'].includes(endpoint.protocol)) return null;
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
    if (!endpoint.pathname.endsWith("/jobs")) {
      endpoint.pathname = `${endpoint.pathname}/jobs`.replace(/\/{2,}/g, "/");
    }
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint.toString();
  } catch {
    return null;
  }
}

export function runnerUrls(value: string) {
  const endpoint = normalizeRunnerEndpoint(value);
  if (!endpoint) return null;
  const jobsUrl = new URL(endpoint);
  return {
    endpoint,
    origin: jobsUrl.origin,
    jobsUrl: jobsUrl.toString(),
    healthUrl: new URL("/health", jobsUrl).toString(),
  };
}

export async function readRegisteredRunner() {
  return getD1().prepare(`SELECT endpoint, instance_id AS instanceId, last_seen_at AS lastSeenAt,
    rotate_requested_at AS rotateRequestedAt FROM runner_endpoints WHERE id = ? LIMIT 1`)
    .bind(PRIMARY_RUNNER_ID).first<RunnerEndpointRow>();
}

export async function resolveRunnerEndpoint() {
  const registered = await readRegisteredRunner().catch(() => null);
  const lastSeen = registered ? Date.parse(registered.lastSeenAt) : 0;
  if (registered && Number.isFinite(lastSeen) && Date.now() - lastSeen <= RUNNER_HEARTBEAT_TTL_MS) {
    const endpoint = normalizeRunnerEndpoint(registered.endpoint);
    if (endpoint) return endpoint;
  }
  return normalizeRunnerEndpoint(process.env.CODEX_RUNNER_URL);
}

export async function checkRunnerHealth(endpoint: string | null) {
  const urls = endpoint ? runnerUrls(endpoint) : null;
  if (!urls) return { online: false, configured: false, code: "EXECUTOR_CONFIG_INVALID" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUNNER_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(urls.healthUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const body = response.headers.get("content-type")?.includes("application/json")
      ? await response.json().catch(() => null) as { ok?: boolean; deploymentProviderConfigured?: boolean } | null
      : null;
    const online = Boolean(response.ok && body?.ok && body.deploymentProviderConfigured);
    return {
      online,
      configured: true,
      code: online ? null : "EXECUTOR_UNHEALTHY",
    };
  } catch {
    return { online: false, configured: true, code: "EXECUTOR_UNREACHABLE" };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestRunnerRotation() {
  const result = await getD1().prepare(`UPDATE runner_endpoints
    SET rotate_requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(PRIMARY_RUNNER_ID).run();
  return Boolean(result.meta.changes);
}

export async function registerRunnerEndpoint(endpointValue: unknown, instanceIdValue: unknown) {
  const endpoint = normalizeRunnerEndpoint(endpointValue);
  const instanceId = typeof instanceIdValue === "string" ? instanceIdValue.slice(0, 120) : "";
  if (!endpoint || new URL(endpoint).protocol !== "https:" || !instanceId) return null;
  const previous = await readRegisteredRunner().catch(() => null);
  const changed = previous?.endpoint !== endpoint || previous?.instanceId !== instanceId;
  await getD1().prepare(`INSERT INTO runner_endpoints (
      id, endpoint, instance_id, last_seen_at, rotate_requested_at, updated_at
    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      endpoint = excluded.endpoint,
      instance_id = excluded.instance_id,
      last_seen_at = CURRENT_TIMESTAMP,
      rotate_requested_at = CASE WHEN runner_endpoints.endpoint <> excluded.endpoint
        OR runner_endpoints.instance_id <> excluded.instance_id THEN NULL
        ELSE runner_endpoints.rotate_requested_at END,
      updated_at = CURRENT_TIMESTAMP`)
    .bind(PRIMARY_RUNNER_ID, endpoint, instanceId).run();
  const current = await readRegisteredRunner();
  return { endpoint, changed, rotate: Boolean(current?.rotateRequestedAt) };
}
