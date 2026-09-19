import { NextRequest, NextResponse } from 'next/server';
import { fetchDispatchList, type DispatchStatus } from '@/lib/appsScript';

// Proxy so ADMIN_KEY never reaches the browser — same pattern as
// /api/deliveries. The middleware already requires a session for /api/*, so
// this is reachable only by a signed-in operator.
export const dynamic = 'force-dynamic';

const STATUSES: DispatchStatus[] = ['all', 'outstanding', 'delivered'];

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const rawStatus = (p.get('status') ?? 'outstanding') as DispatchStatus;
  // Validated against a list rather than passed through: an unexpected value
  // would be forwarded to Apps Script and silently treated as 'all', quietly
  // showing delivered parcels in what the operator believes is a chase list.
  const status = STATUSES.includes(rawStatus) ? rawStatus : 'outstanding';

  const offset = Math.max(0, Number(p.get('offset') ?? 0) || 0);
  const rawLimit = Number(p.get('limit') ?? 50) || 50;
  const limit = Math.min(500, Math.max(1, rawLimit)); // server caps at 500 too

  const data = await fetchDispatchList({
    offset,
    limit,
    status,
    q: p.get('q') ?? '',
    batch: p.get('batch') ?? ''
  });

  // fetchDispatchList never throws: an empty or absent Dispatch tab is a normal
  // first-run state. A transport/config failure still carries `error`, and 200
  // keeps that distinguishable from "not signed in" (401) on the client.
  return NextResponse.json(data);
}
