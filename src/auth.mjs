// Dependency-free auth for the single household login. Uses node:crypto only
// (keeps the backend installable anywhere): scrypt for password hashing,
// HMAC-SHA256 for tamper-proof session cookies.
//
// Auth is ENFORCED only once both AUTH_PASSWORD_HASH and SESSION_SECRET are set
// in .env (run `npm run set-password` to generate them). Until then the API stays
// open (LAN mode) and the server logs a warning — so existing setups don't lock
// themselves out before configuring a password.
import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "hn_session";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 30 * 24 * 3600 * 1000); // 30 days
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

// --- password hashing --------------------------------------------------------

/** Hash a password to a self-describing 'scrypt$salt$hash' string for .env. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verify of a password against a stored 'scrypt$salt$hash'. */
export function verifyPassword(password, stored) {
  if (!password || !stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  let actual;
  try {
    actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- config ------------------------------------------------------------------

export function authConfig() {
  return {
    username: process.env.AUTH_USERNAME ?? "admin",
    passwordHash: process.env.AUTH_PASSWORD_HASH ?? null,
    secret: process.env.SESSION_SECRET ?? null,
    secureCookie: process.env.AUTH_SECURE_COOKIE === "1", // set when served over HTTPS
  };
}

/** Auth is on only once a password hash + session secret are configured. */
export function authEnabled() {
  const c = authConfig();
  return !!(c.passwordHash && c.secret);
}

// --- session tokens (HMAC-signed) -------------------------------------------

const b64u = (s) => Buffer.from(s).toString("base64url");
const sign = (data, secret) => createHmac("sha256", secret).update(data).digest("base64url");

export function issueSession(username) {
  const { secret } = authConfig();
  const payload = b64u(JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(token) {
  const { secret } = authConfig();
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!exp || exp < Date.now()) return null;
    return { username: u };
  } catch {
    return null;
  }
}

// --- cookie helpers ----------------------------------------------------------

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookie(token) {
  const secure = authConfig().secureCookie ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

export function clearCookie() {
  const secure = authConfig().secureCookie ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

/** Extract & verify the session from a request's Cookie header (or null). */
export function sessionFromReq(req) {
  return verifySession(parseCookies(req.headers.cookie ?? "")[COOKIE]);
}
