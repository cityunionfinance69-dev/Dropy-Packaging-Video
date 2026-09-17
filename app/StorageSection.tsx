import { Suspense } from 'react';
import { fetchQuota, getStorageAccounts, type StorageAccountConfig } from '@/lib/appsScript';
import { StorageCard } from '@/components/StorageCard';
import { StorageSummary } from './StorageSummary';

// Each storage card is its own async component behind its own <Suspense>, so a
// single slow account can't hold up the other nine.
//
// Why it's built this way: measured against the live endpoints, 9 of 10
// accounts answer in ~2s while one (which varies) can take 60s+ — that's
// Google-side latency on a single attempt, not something retrying fixes.
// Fetching them as one batch made the whole grid wait on that outlier, so
// Overview's storage section took 45-65s to appear even though almost every
// card was ready in two seconds.
//
// Now each card paints the moment its own account replies, and the slow one
// fills in late without blocking anything.
async function OneCard({ acct }: { acct: StorageAccountConfig }) {
  const quota = await fetchQuota(acct);
  return <StorageCard data={quota} />;
}

function CardSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The label is known before the data is, so show it — a skeleton
              that already names the account tells you what's still loading. */}
          <div className="truncate text-sm font-medium text-muted">{label}</div>
          <div className="mt-1.5 h-2 w-32 animate-pulse rounded bg-raised" />
        </div>
        <div className="h-4 w-10 animate-pulse rounded bg-raised" />
      </div>
      <div className="mt-3 h-2 w-full animate-pulse rounded-full bg-raised" />
      <div className="mt-3 h-2.5 w-36 animate-pulse rounded bg-raised" />
    </div>
  );
}

export function StorageSection() {
  const accounts = getStorageAccounts();

  if (accounts.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted">
        No storage accounts configured yet — set{' '}
        <code className="rounded bg-raised px-1 py-0.5 font-mono text-[11px] text-accent">DROPPY_STORAGE_ACCOUNTS</code>{' '}
        in your environment.
      </p>
    );
  }

  return (
    <>
      {/* The summary needs every account before it can say "N of M nearly
          full", so it gets its own boundary and resolves last. */}
      <Suspense fallback={<div className="mt-3 h-[52px] animate-pulse rounded-xl border border-border bg-panel shadow-card" />}>
        <StorageSummary />
      </Suspense>

      {/* Config order, not fullest-first: sorting would require awaiting every
          account, which is exactly the blocking this structure removes. The
          summary above carries the "which ones are critical" signal instead,
          and each card states its own percentage. */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {accounts.map((acct) => (
          <Suspense key={acct.label} fallback={<CardSkeleton label={acct.label} />}>
            <OneCard acct={acct} />
          </Suspense>
        ))}
      </div>
    </>
  );
}

/** Kept for the page-level fallback before any account has been requested. */
export function StorageSkeleton() {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 6 }).map((_, i) => (
        <CardSkeleton key={i} label="…" />
      ))}
    </div>
  );
}
