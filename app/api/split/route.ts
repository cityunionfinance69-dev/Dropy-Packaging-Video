import { NextRequest, NextResponse } from 'next/server';
import { fetchSplitList } from '@/lib/appsScript';

// Proxy so ADMIN_KEY stays server-side. Middleware already gates /api/* behind
// a session, so this is reachable only by a signed-in operator.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const offset = Math.max(0, Number(p.get('offset') ?? 0) || 0);
  // 300 is the server's hard cap. These count ORDERS, which fan out into
  // parcels, so a page of 50 can be several hundred rows of detail.
  const limit = Math.min(300, Math.max(1, Number(p.get('limit') ?? 50) || 50));

  // verify=1 costs one Shopify call per order on the page, so it is only ever
  // an explicit action — never inferred, never on by default.
  const verify = p.get('verify') === '1';

  const data = await fetchSplitList({
    offset,
    limit,
    q: p.get('q') ?? '',
    baseOrder: p.get('baseOrder') ?? '',
    verify
  });

  return NextResponse.json(data);
}
