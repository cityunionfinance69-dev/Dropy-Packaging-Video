import { NextRequest, NextResponse } from 'next/server';

// drive.google.com/thumbnail and the lh3.googleusercontent.com URL it redirects
// to both get blocked by Chrome's Opaque Response Blocking (ORB) when loaded
// from an <img> tag on a real page — confirmed against a live Chromium browser,
// not just curl (curl doesn't enforce ORB, so it looked fine there). ORB checks
// the redirect response's own headers, and drive.google.com/thumbnail serves
// its 302 with Content-Type: application/binary and no CORS/CORP headers, which
// ORB rejects outright regardless of what the final redirect target returns.
//
// Fetching server-side sidesteps this entirely — ORB is a browser <img>/fetch
// protection, not a restriction on the file's sharing settings, so a plain
// server-side fetch() gets the real bytes with no extra auth needed for files
// already shared "anyone with link".
const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{10,100}$/;
const SIZE_RE = /^w\d{2,4}$/;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !DRIVE_FILE_ID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid or missing file id' }, { status: 400 });
  }
  const rawSize = req.nextUrl.searchParams.get('sz') || 'w160';
  const size = SIZE_RE.test(rawSize) ? rawSize : 'w160';

  try {
    const res = await fetch(`https://drive.google.com/thumbnail?id=${id}&sz=${size}`, {
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok || !res.body) {
      return NextResponse.json({ success: false, error: `Drive returned HTTP ${res.status}` }, { status: 502 });
    }

    return new NextResponse(res.body, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (err) {
    console.error('thumbnail route error:', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch thumbnail' }, { status: 502 });
  }
}
