import { fetchAllQuotas } from '@/lib/appsScript';

// The fleet-level answer to "do we have room?", in its own Suspense boundary
// so it can await every account without delaying the individual cards.
//
// Why it does NOT just show total free space: measured live, the fleet reports
// ~10,217 GB free — but ~10,000 GB of that sits on two large accounts, while 7
// of the 8 standard 15 GB accounts are >=90% full with ~4-6 GB left between
// them. Uploads land on the standard accounts, so a "10,217 GB free" headline
// said "plenty of room" while the accounts actually receiving files were nearly
// out. Leading with how many accounts are nearly full, and reporting headroom
// only for those, is the number that reflects the real constraint.
export async function StorageSummary() {
  // fetchAllQuotas resolves only when every account has answered or timed out,
  // so this line inherits the slowest account in the fleet — two of which
  // currently never answer. The individual cards each stream on their own
  // boundary and are unaffected; it is only this one summary line that waits,
  // and it is the last thing on the page anyone needs.
  const quotas = await fetchAllQuotas();

  const reachable = quotas.filter((q) => q.success);
  const withQuota = reachable.filter((q) => q.limitBytes > 0);
  if (withQuota.length === 0) return null;

  const gb = (b: number) => b / 1024 ** 3;
  const pctOf = (q: (typeof quotas)[number]) => q.usedBytes / q.limitBytes;

  const critical = withQuota.filter((q) => pctOf(q) >= 0.9);
  const warning = withQuota.filter((q) => pctOf(q) >= 0.75 && pctOf(q) < 0.9);
  const unreachable = quotas.length - reachable.length;
  const criticalFree = critical.reduce((n, q) => n + q.freeBytes, 0);
  const totalUsed = withQuota.reduce((n, q) => n + q.usedBytes, 0);
  const totalLimit = withQuota.reduce((n, q) => n + q.limitBytes, 0);

  return (
    <div
      className={`mt-3 rounded-xl border px-4 py-2.5 shadow-card ${
        critical.length > 0 ? 'border-red/30 bg-red/[0.04]' : 'border-border bg-panel'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {critical.length > 0 ? (
          <span className="font-medium text-red">
            {critical.length} of {withQuota.length} accounts nearly full
          </span>
        ) : (
          <span className="font-medium text-teal">All accounts have room</span>
        )}
        {critical.length > 0 && (
          <span className="tabular text-amber">only {gb(criticalFree).toFixed(1)} GB left on those</span>
        )}
        {warning.length > 0 && <span className="tabular text-muted">{warning.length} filling up</span>}
        <span className="tabular text-faint">
          {gb(totalUsed).toFixed(0)} GB used of {gb(totalLimit).toFixed(0)} GB total
        </span>
        {unreachable > 0 && <span className="text-amber">{unreachable} unreachable</span>}
      </div>
      {critical.length > 0 && (
        <p className="mt-1 text-[11px] text-faint">
          Uploads go to whichever account has room — purge archived media or add capacity before these fill.
        </p>
      )}
    </div>
  );
}
