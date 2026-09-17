import { NextRequest, NextResponse } from 'next/server';
import { assignOrder } from '@/lib/appsScript';

// Proxy so the browser never sees ADMIN_KEY — same pattern as /api/deliveries.
// POST (not GET) because this WRITES to the sheet: it must never be triggered
// by a prefetch, a link, or a crawler.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { trackingId?: string; orderName?: string; force?: boolean; unverified?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const trackingId = String(body.trackingId ?? '').trim();
  const orderName = String(body.orderName ?? '').trim();

  if (!trackingId) return NextResponse.json({ success: false, error: 'trackingId is required' }, { status: 400 });
  if (!orderName) return NextResponse.json({ success: false, error: 'Enter an order number' }, { status: 400 });

  try {
    const result = await assignOrder(trackingId, orderName, body.force === true, body.unverified === true);
    // The Apps Script side reports its own failures in the body with HTTP 200
    // (order not found, row already assigned, endpoint not deployed), so map
    // those to 422 — the request was well-formed, the action was refused.
    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (err) {
    console.error('assign-order route error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to reach Apps Script' },
      { status: 502 }
    );
  }
}
