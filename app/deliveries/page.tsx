import { Suspense } from 'react';
import { DeliveryTable } from '@/components/DeliveryTable';
import { StatStrip, StatStripSkeleton } from './StatStrip';

export const dynamic = 'force-dynamic';

// This page awaits nothing itself: the stat strip streams behind <Suspense>
// while the table (a client component fetching its own rows) starts loading
// immediately. Previously the page awaited fetchStats first, so the table —
// the actual reason you're on this page — couldn't even begin until the
// whole-sheet scan finished.
export default function DeliveriesPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ink">Deliveries</h1>
      <p className="mt-1 text-sm text-muted">Every tracking ID, its proof media, and Shopify status.</p>

      <Suspense fallback={<StatStripSkeleton />}>
        <StatStrip />
      </Suspense>

      <div className="mt-6">
        <DeliveryTable />
      </div>
    </div>
  );
}
