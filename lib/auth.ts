// Session cookies for the shared-password login.
//
// The cookie is a signed token, never the password itself. Storing the password
// (or a plain "loggedIn=true" flag) would let anyone forge access by typing a
// cookie into their browser; a token signed with a server-only secret cannot be
// produced without that secret.
//
// Web Crypto rather than node:crypto throughout, because middleware.ts runs on
// the Edge runtime where node:crypto is unavailable. The same functions then
// work in both places.

const ENCODER = new TextEncoder();

/** How long a login lasts before the password is needed again. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

export const SESSION_COOKIE = 'droppy_session';

/**
 * Constant-time string comparison.
 *
 * A plain `a === b` leaks how much of the password was correct through timing:
 * it returns early at the first differing byte. This always walks the full
 * length, so the time taken says nothing about how close a guess was.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = ENCODER.encode(a);
  const bb = ENCODER.encode(b);
  // Comparing lengths first would itself leak, so fold the length difference
  // into the result instead of returning early.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify'
  ]);
}

function toBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mint a session token: "<expiresAtMs>.<hmac>".
 *
 * The expiry is inside the signed payload, so a client cannot extend its own
 * session by editing the cookie — changing the timestamp invalidates the
 * signature.
 */
export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = String(expiresAt);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), ENCODER.encode(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

/** True only for a token this server signed that has not yet expired. */
export async function verifySessionToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = toBase64Url(await crypto.subtle.sign('HMAC', await hmacKey(secret), ENCODER.encode(payload)));
  return safeEqual(provided, expected);
}

/**
 * The server-side secret used to sign sessions, and the password users type.
 *
 * Both are required in production. Returning undefined rather than throwing
 * lets the caller decide what to do — middleware must fail CLOSED (deny
 * everything) if the app is misconfigured, which is safer than a thrown error
 * that might be caught and swallowed into an allow.
 */
export function authConfig(): { password?: string; secret?: string } {
  return {
    // Trimmed for the same reason as requireEnv: a newline picked up while
    // pasting into a hosting dashboard would make the correct password fail
    // to match, with nothing on screen to explain why.
    password: process.env.DASHBOARD_PASSWORD?.trim(),
    // Falling back to the password as the signing key keeps setup to one env
    // var. It is still never sent to the browser — only HMACs of it are.
    secret: process.env.SESSION_SECRET?.trim() || process.env.DASHBOARD_PASSWORD?.trim()
  };
}
