import { jsonError, requireSession } from "../../../lib/server-auth";

export async function GET(request: Request) {
  const user = await requireSession(request);
  if (!user) return jsonError("未登录", 401);
  return Response.json({ user }, { headers: { "cache-control": "no-store" } });
}
