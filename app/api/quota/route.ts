import { NextResponse } from 'next/server';
import { fetchAllQuotas } from '@/lib/appsScript';

// Without this, Next.js sees no request-specific data being read (no params,
// no cookies) and quietly caches this route's response at BUILD time — so
// storage usage would be frozen at whatever it was when you last deployed.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const quotas = await fetchAllQuotas();
    return NextResponse.json({ success: true, accounts: quotas });
  } catch (err) {
    console.error('quota route error:', err);
    return NextResponse.json({ success: false, error: 'Failed to reach storage accounts' }, { status: 502 });
  }
}
