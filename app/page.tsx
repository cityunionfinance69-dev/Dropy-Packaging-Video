import { Suspense } from 'react';
import { StorageSection, StorageSkeleton } from './StorageSection';
import { StatsSection, StatsSkeleton } from './StatsSection';

// Revalidated rather than force-dynamic.
//
// This page makes eleven Apps Script calls — ten storage quotas plus the sheet
// stats — and finishes when the slowest answers, which measured 12-21s live.
// Every call is 2-3s of script startup before it reads anything, so the only
// way below that is to not make them on every view.
//
// 60s is chosen against what the numbers actually are: Drive quotas move as
// parcels are filmed through the day, and sheet totals by the minute. Nobody
// acts differently on a storage bar that is one minute old, and the page now
// costs one round trip a minute instead of one per visitor.
//
// The delivery table is deliberately NOT cached — see DeliveryTable, which
// fetches its own rows client-side and stays live.
export const revalidate = 60;

// The page shell itself awaits NOTHING. Each data-backed section is its own
// async component behind its own <Suspense>, so the header and layout paint
// immediately and each section fills in when its data lands.
//
// This matters concretely here: the slowest storage account takes ~21s and the
// stats endpoint scans 2.5k rows. Previously both were awaited together in this
// component, so the entire page — including static text — waited ~30s.
function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
      {sub && <span className="text-[11px] text-faint">{sub}</span>}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <div className="w-full">
      <h1 className="text-lg font-semibold text-ink">Overview</h1>
      <p className="mt-1 text-sm text-muted">Drive storage across accounts, and sheet health at a glance.</p>

      <section className="mt-7">
        <SectionHeading title="Storage" sub="fullest first" />
        <Suspense fallback={<StorageSkeleton />}>
          <StorageSection />
        </Suspense>
      </section>

      <section className="mt-9">
        <SectionHeading title="Needs attention" />
        <Suspense fallback={<StatsSkeleton />}>
          <StatsSection />
        </Suspense>
      </section>

      <a href="/health" className="mt-7 inline-block text-xs text-accent hover:underline">
        See row-level detail →
      </a>
    </div>
  );
}
