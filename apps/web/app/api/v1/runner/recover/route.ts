import { jsonError, requireSession } from "../../../../lib/server-auth";
import {
  checkRunnerHealth,
  readRegisteredRunner,
  registerRunnerEndpoint,
  resolveRunnerEndpoint,
} from "../../../../lib/runner-endpoint";

async function status() {
  const registered = await readRegisteredRunner().catch(() => null);
  const endpoint = await resolveRunnerEndpoint();
  const health = await checkRunnerHealth(endpoint);
  return {
    online: health.online,
    recovering: Boolean(registered?.rotateRequestedAt),
    registered: Boolean(registered),
    code: health.code,
  };
}

export async function GET(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  return Response.json(await status(), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  const body = await request.json().catch(() => null) as { endpoint?: unknown; instanceId?: unknown } | null;
  if (body?.endpoint || body?.instanceId) {
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : null;
    const instanceId = typeof body.instanceId === "string" ? body.instanceId : null;
    const health = await checkRunnerHealth(endpoint);
    if (!health.online || !instanceId || health.instanceId !== instanceId) {
      return Response.json({
        online: false,
        error: "新 Runner 地址未通过实例身份与健康检查",
        code: "EXECUTOR_RECOVERY_REJECTED",
      }, { status: 422, headers: { "cache-control": "no-store" } });
    }
    const registration = await registerRunnerEndpoint(endpoint, instanceId);
    if (!registration) return jsonError("新 Runner 地址无效", 422);
    return Response.json({
      online: true,
      recovering: false,
      registered: true,
      message: "Runner 新连接已登记",
    }, { headers: { "cache-control": "no-store" } });
  }
  const current = await status();
  if (current.online) {
    return Response.json({ ...current, message: "Runner 连接正常，无需更换" }, { headers: { "cache-control": "no-store" } });
  }
  return Response.json({
    ...current,
    error: "当前 Runner 地址不可用，请从运行 Runner 的设备发起本地连接修复",
    code: "EXECUTOR_LOCAL_RECOVERY_REQUIRED",
  }, { status: 503, headers: { "cache-control": "no-store" } });
}
