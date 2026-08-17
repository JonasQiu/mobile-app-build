import { env } from "cloudflare:workers";
import { chatGPTUserFromHeaders } from "../chatgpt-auth";

const SESSION_COOKIE = "mobile_build_session";
const SESSION_DAYS = 7;

export type SessionUser = { id: string; username: string };

export function getD1(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function ensureDatabase() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized ON users(username_normalized)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      current_stage TEXT,
      preview_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_user_id, updated_at DESC)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS runner_endpoints (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      rotate_requested_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);
}

export async function verifyPassword(password: string, salt: string, iterations: number, expectedHash: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations },
    key,
    256,
  );
  return timingSafeEqual(bytesToHex(new Uint8Array(bits)), expectedHash);
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

export function createSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionToken(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

export async function requireSession(request: Request): Promise<SessionUser | null> {
  const chatGPTUser = chatGPTUserFromHeaders(request.headers);
  if (!chatGPTUser) return null;
  await ensureDatabase();

  const normalizedEmail = chatGPTUser.email.trim().toLowerCase();
  const ownerEmail = String(process.env.SITE_OWNER_EMAIL || "").trim().toLowerCase();
  const identityHash = await hashToken(chatGPTUser.userId);
  const userId = ownerEmail && normalizedEmail === ownerEmail
    ? "usr_joans"
    : `usr_chatgpt_${identityHash.slice(0, 24)}`;
  const username = chatGPTUser.displayName.trim().slice(0, 80) || normalizedEmail;

  await getD1().prepare(`INSERT INTO users (
    id, username, username_normalized, password_hash, password_salt, password_iterations, status
  ) VALUES (?, ?, ?, '', '', 1, 'active')
  ON CONFLICT(id) DO UPDATE SET
    username = excluded.username,
    username_normalized = excluded.username_normalized,
    status = 'active'`)
    .bind(userId, username, normalizedEmail)
    .run();

  return { id: userId, username };
}

export function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
