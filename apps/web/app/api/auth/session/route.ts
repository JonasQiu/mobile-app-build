import { requireSession } from "../../../lib/server-auth";
import { chatGPTSignInPath } from "../../../chatgpt-auth";

export async function GET(request: Request) {
  const user = await requireSession(request);
  if (!user) {
    return Response.json(
      { error: "请使用 ChatGPT 登录", signInUrl: chatGPTSignInPath("/") },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json({ user }, { headers: { "cache-control": "no-store" } });
}
