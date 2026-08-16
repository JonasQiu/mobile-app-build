import { ensureDatabase, jsonError } from "../../../../lib/server-auth";
import { registerRunnerEndpoint } from "../../../../lib/runner-endpoint";

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function POST(request: Request) {
  const expected = process.env.RUNNER_CALLBACK_TOKEN || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !supplied || !timingSafeEqual(expected, supplied)) return jsonError("未授权的执行器", 401);
  await ensureDatabase();
  const body = await request.json().catch(() => null) as { endpoint?: unknown; instanceId?: unknown } | null;
  const registration = await registerRunnerEndpoint(body?.endpoint, body?.instanceId);
  if (!registration) return jsonError("Runner 地址或实例编号无效", 400);
  return Response.json({
    ok: true,
    rotate: registration.rotate,
  }, { headers: { "cache-control": "no-store" } });
}
