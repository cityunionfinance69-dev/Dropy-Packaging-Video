import { fetchStats } from '@/lib/appsScript';
import { StatBlock } from '@/components/StatBlock';

// Own async component so the delivery TABLE renders immediately instead of
// waiting on the whole-sheet stats scan (~3s). The table fetches its own rows
// client-side and never depended on these numbers.
export async function StatStrip() {
  const stats = await fetchStats();

  if (!stats.success) {
    return (
      <p className="mt-5 rounded-xl border border-amber/30 bg-amber/[0.04] px-3 py-2 text-xs text-amber">
        {stats.error ?? 'Summary stats unavailable.'}{' '}
        <span className="text-muted">The delivery table below is unaffected.</span>
      </p>
    );
  }

  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatBlock value={stats.totalRows.toLocaleString()} label="Total deliveries" />
      <StatBlock value={stats.delivered.toLocaleString()} label="Delivered" tone="good" />
      <StatBlock
        value={stats.blankOrderName}
        label="Unmatched"
        hint="No verified Shopify order"
        tone={stats.blankOrderName > 0 ? 'bad' : 'neutral'}
        href="/health"
      />
      <StatBlock
        value={stats.deliveredNoFileIds}
        label="Delivered, no media"
        hint="No proof of delivery on file"
        tone={stats.deliveredNoFileIds > 0 ? 'warn' : 'neutral'}
      />
    </div>
  );
}

export function StatStripSkeleton() {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-panel px-3.5 py-3 shadow-card">
          <div className="h-6 w-14 animate-pulse rounded bg-raised" />
          <div className="mt-2 h-2.5 w-24 animate-pulse rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}
