import { createSessionToken, ensureDatabase, getD1, hashToken, jsonError, sessionCookie, sessionExpiry, verifyPassword } from "../../../lib/server-auth";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const payload = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
    const username = typeof payload?.username === "string" ? payload.username.trim().toLowerCase() : "";
    const password = typeof payload?.password === "string" ? payload.password : "";
    if (!username || !password || username.length > 80 || password.length > 256) {
      return jsonError("账号或密码不正确", 401);
    }

    const user = await getD1().prepare(`SELECT id, username, password_hash AS passwordHash,
      password_salt AS passwordSalt, password_iterations AS passwordIterations
      FROM users WHERE username_normalized = ? AND status = 'active' LIMIT 1`)
      .bind(username)
      .first<{ id: string; username: string; passwordHash: string; passwordSalt: string; passwordIterations: number }>();
    const valid = user && await verifyPassword(password, user.passwordSalt, user.passwordIterations, user.passwordHash);
    if (!user || !valid) return jsonError("账号或密码不正确", 401);

    const token = createSessionToken();
    await getD1().prepare(`INSERT INTO sessions (id, token_hash, user_id, expires_at)
      VALUES (?, ?, ?, ?)`)
      .bind(`ses_${crypto.randomUUID()}`, await hashToken(token), user.id, sessionExpiry())
      .run();

    return Response.json(
      { user: { id: user.id, username: user.username } },
      { headers: { "set-cookie": sessionCookie(token), "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Login request failed", error instanceof Error ? error.message : "Unknown error");
    return jsonError("登录服务暂时不可用，请稍后重试", 500);
  }
}
