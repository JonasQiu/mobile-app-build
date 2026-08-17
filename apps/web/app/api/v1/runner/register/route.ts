import { jsonError } from "../../../../lib/server-auth";
import { checkRunnerHealth, registerRunnerEndpoint } from "../../../../lib/runner-endpoint";

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function POST(request: Request) {
  const expected = process.env.RUNNER_CALLBACK_TOKEN || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !supplied || !timingSafeEqual(expected, supplied)) {
    return jsonError("未授权的执行器", 401);
  }

  const body = await request.json().catch(() => null) as { endpoint?: unknown; instanceId?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null;
  const instanceId = typeof body?.instanceId === "string" ? body.instanceId : null;
  if (!endpoint || !instanceId) return jsonError("Runner 地址和实例编号不能为空", 400);

  const health = await checkRunnerHealth(endpoint);
  if (!health.online || health.instanceId !== instanceId) {
    return Response.json({
      online: false,
      error: "Runner 自动登记未通过公网实例身份与健康检查",
      code: "EXECUTOR_REGISTRATION_REJECTED",
    }, { status: 422, headers: { "cache-control": "no-store" } });
  }

  const registration = await registerRunnerEndpoint(endpoint, instanceId);
  if (!registration) return jsonError("Runner 地址无效", 422);
  return Response.json({
    online: true,
    registered: true,
    changed: registration.changed,
  }, { headers: { "cache-control": "no-store" } });
}
