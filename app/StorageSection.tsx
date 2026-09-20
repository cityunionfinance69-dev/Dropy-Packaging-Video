import { Suspense } from 'react';
import { fetchQuota, getStorageAccounts, type StorageAccountConfig } from '@/lib/appsScript';
import { StorageCard } from '@/components/StorageCard';
import { StorageSummary } from './StorageSummary';
import { StorageProgress } from '@/components/StorageProgress';

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

// How many accounts answered, so the page can admit when it is showing a
// partial fleet. Under a 60s cache a failed account is frozen for the whole
// window, and ten cards where two say nothing is indistinguishable from eight
// accounts existing — which would quietly understate how full storage is.
async function FleetNote() {
  const accounts = getStorageAccounts();
  const quotas = await Promise.all(accounts.map((a) => fetchQuota(a)));
  const missing = quotas.filter((q) => !q.success);
  if (missing.length === 0) return null;

  return (
    <p className="mt-2 text-[11px] text-amber">
      {missing.length} of {accounts.length} accounts did not answer this minute (
      {missing.map((m) => m.label).join(', ')}). Their usage is not counted in the totals above.
    </p>
  );
}

function CardSkeleton({ label }: { label: string }) {
  return (
    <div data-storage-card="pending" className="rounded-xl border border-dashed border-border bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The label is known before the data is, so name the account: a
              skeleton that says WHICH account is still coming is the
              difference between "working" and "stuck". */}
          <div className="truncate text-sm font-medium text-muted">{label}</div>
          <div className="mt-1.5 h-2 w-32 animate-pulse rounded bg-raised" />
        </div>
        {/* Says it in words, not only as a shape. Some of these accounts take
            the better part of a minute, and a bare grey rectangle for that long
            reads as a failure. */}
        <span className="shrink-0 whitespace-nowrap text-[10px] text-faint">checking…</span>
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

      {/* Counts cards as they stream in. The account total is known up front
          from config, so this can say "6 of 10" without waiting for any of
          them — which is the whole point. */}
      <StorageProgress total={accounts.length} />

      <Suspense fallback={null}>
        <FleetNote />
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
