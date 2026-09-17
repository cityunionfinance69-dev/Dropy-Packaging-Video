import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, authConfig, createSessionToken, safeEqual } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Simple in-memory throttle.
//
// A single shared password is guessable if an attacker may try endlessly, and
// this endpoint is the one place guesses can be made. Five attempts per IP per
// fifteen minutes makes an online brute-force impractical while never getting
// in a real user's way.
//
// In memory, so it resets on redeploy and is per-instance rather than global —
// that is a real limitation, not a claim of bulletproof protection. It raises
// the cost of guessing enormously for a dashboard this size; a bigger system
// would want a shared store.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const rec = attempts.get(ip);

  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }
  rec.count += 1;
  if (rec.count > MAX_ATTEMPTS) {
    return { ok: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

export async function POST(req: NextRequest) {
  const { password, secret } = authConfig();
  if (!password || !secret) {
    return NextResponse.json(
      { success: false, error: 'DASHBOARD_PASSWORD is not set on the server.' },
      { status: 503 }
    );
  }

  // x-forwarded-for is set by Vercel's proxy; the first entry is the client.
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return NextResponse.json(
      { success: false, error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minute(s).` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 });
  }

  // Constant-time compare — see safeEqual for why `===` is not used here.
  if (!body.password || !safeEqual(body.password, password)) {
    return NextResponse.json({ success: false, error: 'Incorrect password.' }, { status: 401 });
  }

  // Correct password clears that IP's failure count.
  attempts.delete(ip);

  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(secret), {
    // httpOnly: JavaScript on the page cannot read it, so an XSS bug cannot
    //   steal the session.
    httpOnly: true,
    // secure: never sent over plain HTTP in production. Left off in dev so
    //   http://localhost still works.
    secure: process.env.NODE_ENV === 'production',
    // sameSite lax: the cookie is not attached to cross-site POSTs, which is
    //   what stops another site from driving the write endpoints as you (CSRF).
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS
  });
  return res;
}

/** Sign out: drop the cookie. */
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
