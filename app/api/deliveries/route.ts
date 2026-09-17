import { NextRequest, NextResponse } from 'next/server';
import { fetchDeliveries } from '@/lib/appsScript';

// Notice how little logic lives here — that's the point of lib/appsScript.ts.
// This route's only job is: read query params, call the client, return JSON.
export async function GET(req: NextRequest) {
  const offset = Number(req.nextUrl.searchParams.get('offset') ?? 0);
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? 200);

  try {
    const data = await fetchDeliveries(offset, limit);
    return NextResponse.json(data);
  } catch (err) {
    // Never let the raw error (which could contain env var contents) leak to the client.
    console.error('deliveries route error:', err);
    return NextResponse.json({ success: false, error: 'Failed to reach Apps Script' }, { status: 502 });
  }
}
