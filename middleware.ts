import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, authConfig, verifySessionToken } from '@/lib/auth';

// One gate in front of everything.
//
// Putting the check here rather than in each page means a route added later is
// protected by default — the failure mode of per-page checks is the page
// someone forgets. The API routes matter as much as the pages: /api/deliveries
// returns every customer's name, phone and order value, and /api/assign-order
// WRITES to the sheet, so leaving those open while gating only the HTML would
// protect nothing.

export const config = {
  // Everything except Next's own static assets and the favicon. The login page
  // and its API are allowed through inside the handler, not here, so that the
  // "is auth even configured" check still runs for them.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};

const PUBLIC_PATHS = ['/login', '/api/login'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const { password, secret } = authConfig();

  // Fail CLOSED. If DASHBOARD_PASSWORD is unset the app is misconfigured, and
  // serving the dashboard to everyone is far worse than serving an error — this
  // is exactly the case where a "convenient" fallback becomes the vulnerability.
  if (!password || !secret) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'DASHBOARD_PASSWORD is not set on the server.' },
        { status: 503 }
      );
    }
    return new NextResponse(
      '<!doctype html><meta charset="utf-8"><title>Setup required</title>' +
        '<body style="font:14px/1.6 system-ui;max-width:34rem;margin:15vh auto;padding:0 1.25rem;color:#101828">' +
        '<h1 style="font-size:1.1rem">Setup required</h1>' +
        '<p>This dashboard has no password configured, so it is refusing to serve rather than exposing delivery data.</p>' +
        '<p>Set <code>DASHBOARD_PASSWORD</code> (and ideally <code>SESSION_SECRET</code>) in the environment and restart.</p>' +
        '</body>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  const authed = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, secret);

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    // Already signed in and heading for the login page — send them onward
    // rather than showing a form they don't need.
    if (authed && pathname === '/login') {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  if (authed) return NextResponse.next();

  // An unauthenticated API call gets JSON, not an HTML redirect: a fetch()
  // following a redirect to the login page would otherwise surface as a
  // confusing parse error in the client.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ success: false, error: 'Not signed in.' }, { status: 401 });
  }

  const login = new URL('/login', req.url);
  // Remember where they were headed so the login can return them there.
  if (pathname !== '/') login.searchParams.set('next', pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}
