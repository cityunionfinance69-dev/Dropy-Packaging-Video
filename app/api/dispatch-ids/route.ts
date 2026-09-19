import { NextResponse } from 'next/server';
import { fetchDispatchList } from '@/lib/appsScript';

// Just the tracking IDs that have a dispatch scan, so /deliveries can mark the
// audit-gap rows — delivered with no record of leaving the warehouse.
//
// One call, a flat array of strings. A request per row would be ~20 joins of
// two sheets per page; the client turns this into a Set instead.
export const dynamic = 'force-dynamic';

export async function GET() {
  // 500 is the server's hard cap per call, so this walks pages until the sheet
  // is exhausted. Bounded so a runaway sheet cannot loop forever.
  const ids: string[] = [];
  let offset = 0;
  let guard = 0;

  while (guard++ < 40) {
    const page = await fetchDispatchList({ offset, limit: 500, status: 'all' });
    if (!page.success) {
      // An empty or absent Dispatch tab is a normal first-run state, so this
      // reports "no ids" rather than an error — /deliveries then simply shows
      // no dispatch column content instead of an error banner.
      return NextResponse.json({ success: false, ids: [], error: page.error });
    }
    for (const r of page.rows) if (r.trackingId) ids.push(r.trackingId);
    if (!page.hasMore) break;
    offset += 500;
  }

  return NextResponse.json({ success: true, ids });
}
