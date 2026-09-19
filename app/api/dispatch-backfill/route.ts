import { NextRequest, NextResponse } from 'next/server';
import { runDispatchBackfill } from '@/lib/appsScript';

// POST, not GET: this WRITES to the sheet. A GET would be reachable by a
// prefetch, a link or a crawler, and re-resolving rows is not something that
// should happen because a browser guessed a URL.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let limit = 20;
  try {
    const body = await req.json();
    if (Number.isFinite(body?.limit)) limit = Math.min(200, Math.max(1, Number(body.limit)));
  } catch {
    // No body is fine — the default limit is the common case.
  }

  const result = await runDispatchBackfill(limit);
  return NextResponse.json(result);
}
