import { chatGPTSignInPath } from "../../../chatgpt-auth";

export async function POST() {
  return Response.json(
    { error: "本地账号登录已停用，请使用 ChatGPT 登录", signInUrl: chatGPTSignInPath("/") },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
