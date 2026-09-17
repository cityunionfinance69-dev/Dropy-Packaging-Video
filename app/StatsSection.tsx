import { fetchStats } from '@/lib/appsScript';
import { StatBlock } from '@/components/StatBlock';
import { RetryButton } from '@/components/RetryButton';

// Streams independently of the storage grid — see the note in StorageSection
// for why the two must not share one await.
export async function StatsSection() {
  const stats = await fetchStats();

  if (!stats.success) {
    return (
      <div className="mt-3 rounded-xl border border-amber/30 bg-panel p-4 shadow-card">
        <div className="text-sm font-medium text-ink">Sheet stats unavailable</div>
        <p className="mt-1 text-xs text-muted">
          {stats.error ?? 'The summary endpoint did not respond this time — the sheet itself is fine.'}
        </p>
        <RetryButton />
      </div>
    );
  }

  // Everything that needs a human to do something, separated from the "just so
  // you know" totals — mixing them meant a real problem sat visually level with
  // a routine count.
  const attention = [
    {
      value: stats.blankOrderName,
      label: 'Unmatched rows',
      hint: 'Shopify returned no verified order',
      tone: 'bad' as const,
      href: '/health'
    },
    {
      value: stats.deliveredNoFileIds,
      label: 'Delivered, no media',
      hint: 'No proof of delivery on file',
      tone: 'warn' as const
    },
    {
      value: stats.blankDriveAccount,
      label: 'Missing drive account',
      hint: "Can't locate this row's files",
      tone: 'warn' as const
    },
    {
      value: stats.purgeableNow,
      label: 'Ready to purge',
      hint: 'Past retention, safe to archive',
      tone: 'warn' as const
    }
  ];

  const needsAttention = attention.filter((a) => a.value > 0);

  return (
    <>
      {needsAttention.length === 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-teal/30 bg-teal/[0.04] px-4 py-3 shadow-card">
          <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
          <span className="text-sm text-teal">All clear</span>
          <span className="text-xs text-faint">Every row is matched, has media, and nothing is due for purging.</span>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {needsAttention.map((a) => (
            <StatBlock key={a.label} value={a.value} label={a.label} hint={a.hint} tone={a.tone} href={a.href} />
          ))}
        </div>
      )}

      <div className="mt-8">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Totals</h2>
          <span className="text-[11px] text-faint">whole sheet</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBlock value={stats.totalRows.toLocaleString()} label="Total deliveries" />
          <StatBlock value={stats.delivered.toLocaleString()} label="Delivered" tone="good" />
          <StatBlock value={stats.alreadyPurged.toLocaleString()} label="Media purged" hint="Archived, files removed" />
          <StatBlock value={stats.blankVideoId.toLocaleString()} label="Missing video" hint="Photos may still exist" />
        </div>
      </div>
    </>
  );
}

export function StatsSkeleton() {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-panel px-3.5 py-3 shadow-card">
          <div className="h-6 w-12 animate-pulse rounded bg-raised" />
          <div className="mt-2 h-2.5 w-24 animate-pulse rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}
