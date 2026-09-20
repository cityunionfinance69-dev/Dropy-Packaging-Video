import { NextResponse } from 'next/server';

// Just the tracking IDs that have a dispatch scan, so /deliveries can mark the
// audit-gap rows — delivered with no record of leaving the warehouse.
//
// One call, a flat array of strings. A request per row would be ~20 joins of
// two sheets per page; the client turns this into a Set instead.
export const dynamic = 'force-dynamic';

export async function GET() {
  // idsOnly skips the delivery-log join that dispatchList otherwise does to
  // compute delivered/inTransit/hoursWaiting — fields this endpoint discards.
  // One small read instead of two whole-sheet reads.
  try {
    const base = process.env.DROPPY_MAIN_URL?.trim();
    const key = process.env.DROPPY_ADMIN_KEY?.trim();
    if (!base || !key) return NextResponse.json({ success: false, ids: [] });

    const res = await fetch(
      `${base}?action=dispatchList&key=${encodeURIComponent(key)}&idsOnly=true`,
      { cache: 'no-store', signal: AbortSignal.timeout(20_000) }
    );
    const body = await res.text();

    let data: { success?: boolean; ids?: string[] };
    try {
      data = JSON.parse(body);
    } catch {
      // Apps Script answers HTML when a deployment is unavailable; an empty
      // id set just means the dispatch column stays quiet, which is the right
      // degradation for a page that works fine without it.
      return NextResponse.json({ success: false, ids: [] });
    }

    if (!data.success) return NextResponse.json({ success: false, ids: [] });
    return NextResponse.json({ success: true, ids: data.ids ?? [] });
  } catch {
    return NextResponse.json({ success: false, ids: [] });
  }
}
