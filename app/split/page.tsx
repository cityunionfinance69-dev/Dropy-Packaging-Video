import { Suspense } from 'react';
import { fetchSplitList } from '@/lib/appsScript';
import { StatBlock } from '@/components/StatBlock';
import { SplitOrders } from '@/components/SplitOrders';

// Split orders change only when a multi-parcel order is packed, so a minute of
// staleness is invisible here. The Shopify cross-check is a button and is never
// cached: it exists to give a definitive answer on demand.
export const revalidate = 60;
export const metadata = { title: 'Split orders — Droppy' };

async function SplitView() {
  // verify=1 is never used here: it costs one Shopify call per order and is an
  // explicit action inside the view, not something a page load triggers.
  const initial = await fetchSplitList({ offset: 0, limit: 25 });
  const s = initial.summary;

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatBlock value={s.splitOrders.toLocaleString()} label="Split orders" hint="Shipped as more than one box" />
        <StatBlock value={s.parcels.toLocaleString()} label="Parcels" hint="Boxes across those orders" />
        <StatBlock value={s.units.toLocaleString()} label="Units recorded" hint="Items in recorded boxes" />
      </div>

      <div className="mt-6">
        <SplitOrders initial={initial} />
      </div>
    </>
  );
}

function Skeleton() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-panel px-3.5 py-3 shadow-card">
          <div className="h-6 w-14 animate-pulse rounded bg-raised" />
          <div className="mt-2 h-2.5 w-24 animate-pulse rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}

export default function SplitPage() {
  return (
    <div className="w-full">
      <h1 className="text-lg font-semibold text-ink">Split orders</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Orders that shipped as several parcels, and whether every box actually went out. A half-shipped order looks
        healthy parcel by parcel — grouping them is the only way to see it.
      </p>

      <Suspense fallback={<Skeleton />}>
        <SplitView />
      </Suspense>
    </div>
  );
}
