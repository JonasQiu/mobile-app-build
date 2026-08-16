import { jsonError, requireSession } from "../../../../lib/server-auth";
import {
  checkRunnerHealth,
  readRegisteredRunner,
  requestRunnerRotation,
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
  const current = await status();
  if (current.online) {
    return Response.json({ ...current, message: "Runner 连接正常，无需更换" }, { headers: { "cache-control": "no-store" } });
  }
  const requested = await requestRunnerRotation();
  if (!requested) {
    return Response.json({
      ...current,
      error: "Runner 服务尚未登记，无法自动更换地址；请先启动 Runner 服务",
      code: "EXECUTOR_NOT_REGISTERED",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return Response.json({
    ...current,
    recovering: true,
    message: "已通知 Runner 更换连接地址，正在等待新地址登记",
  }, { status: 202, headers: { "cache-control": "no-store" } });
}
