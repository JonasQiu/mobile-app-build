import { clearedSessionCookie, getD1, hashToken, readSessionToken } from "../../../lib/server-auth";

export async function POST(request: Request) {
  const token = readSessionToken(request);
  if (token) {
    await getD1().prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?")
      .bind(await hashToken(token)).run().catch(() => undefined);
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie(), "cache-control": "no-store" } });
}
