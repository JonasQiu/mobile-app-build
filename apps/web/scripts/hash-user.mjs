#!/usr/bin/env node
// Generate a PBKDF2-SHA256 password hash that matches apps/web's auth
// (see app/lib/server-auth.ts -> verifyPassword).
//
// Usage:
//   node scripts/hash-user.mjs <username> <password>
//
// It prints the id/salt/hash as JSON, plus a ready-to-paste JS upsert block
// for ensureDatabase() and a raw SQL statement for `wrangler d1 execute`.
//
// Params intentionally mirror the app: PBKDF2 + SHA-256, 100000 iterations,
// 256-bit (32-byte) key, salt stored as a UTF-8 string and encoded the same
// way the app does at verify time.
import { pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 100_000;
const KEY_LEN = 32; // 256 bits

const [, , username, password] = process.argv;
if (!username || !password) {
  console.error("Usage: node scripts/hash-user.mjs <username> <password>");
  console.error("Example: node scripts/hash-user.mjs alice 'correct horse battery staple'");
  process.exit(1);
}

const normalized = username.trim().toLowerCase();
const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, "sha256").toString("hex");
const id = "usr_" + randomBytes(8).toString("hex");

console.log("=== JSON ===");
console.log(JSON.stringify({ id, username: normalized, salt, iterations: ITERATIONS, passwordHash: hash }, null, 2));

console.log("\n=== 1) JS upsert — paste into ensureDatabase() in app/lib/server-auth.ts ===\n");
console.log(
  `await db.prepare(\`INSERT INTO users (id, username, username_normalized, password_hash, password_salt, password_iterations, status)
  VALUES (?, ?, ?, ?, ?, ?, 'active')
  ON CONFLICT(username_normalized) DO UPDATE SET
    password_hash = excluded.password_hash,
    password_salt = excluded.password_salt,
    password_iterations = excluded.password_iterations,
    status = 'active'\`)
  .bind("${id}", "${normalized}", "${normalized}", "${hash}", "${salt}", ${ITERATIONS}).run();`
);

console.log("\n=== 2) Raw SQL — wrangler d1 execute DB --command '...' (or --file) ===\n");
console.log(
  `INSERT INTO users (id, username, username_normalized, password_hash, password_salt, password_iterations, status) ` +
  `VALUES ('${id}', '${normalized}', '${normalized}', '${hash}', '${salt}', ${ITERATIONS}, 'active') ` +
  `ON CONFLICT(username_normalized) DO UPDATE SET password_hash=excluded.password_hash, password_salt=excluded.password_salt, password_iterations=excluded.password_iterations, status='active';`
);
