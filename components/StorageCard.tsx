import type { QuotaResponse } from '@/lib/appsScript';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 GB';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

// Three bands, because the operational response differs at each:
//   <75%  fine, ignore it
//   75-90 start thinking about purging
//   >=90  uploads are about to start failing on this account
function band(percent: number): { bar: string; text: string; note: string } {
  if (percent >= 90) return { bar: 'bg-red', text: 'text-red', note: 'Nearly full — purge or add capacity' };
  if (percent >= 75) return { bar: 'bg-amber', text: 'text-amber', note: 'Filling up' };
  return { bar: 'bg-teal', text: 'text-teal', note: '' };
}

export function StorageCard({ data }: { data: QuotaResponse & { label: string } }) {
  if (!data.success) {
    return (
      <div className="rounded-xl border border-red/30 bg-panel p-4 shadow-card">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-red" aria-hidden />
          <div className="text-sm font-medium text-ink">{data.label}</div>
        </div>
        <div className="mt-1.5 text-xs text-red">Unreachable — {data.error ?? 'unknown error'}</div>
        <p className="mt-1 text-[11px] text-faint">
          Storage numbers below are unavailable for this account until its script responds.
        </p>
      </div>
    );
  }

  // limitBytes is 0 on the rare account where Drive's quota lookup itself failed
  // (see capacity_()'s own catch block) — treat that as "unknown" rather than
  // divide-by-zero.
  const percent = data.limitBytes > 0 ? Math.round((data.usedBytes / data.limitBytes) * 1000) / 10 : null;
  const tone = percent === null ? null : band(percent);

  return (
    <div className="rounded-xl border border-border bg-panel p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{data.label}</div>
          <div className="mt-0.5 truncate text-[11px] text-faint" title={data.account}>
            {data.account}
          </div>
        </div>
        {/* The percentage is the headline number — it's what you actually
            compare between accounts, so it gets size and tone. */}
        <div className={`tabular shrink-0 text-lg font-semibold leading-none ${tone?.text ?? 'text-muted'}`}>
          {percent === null ? '—' : `${percent}%`}
        </div>
      </div>

      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${data.label} storage used`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${tone?.bar ?? 'bg-muted'}`}
          style={{ width: `${percent === null ? 8 : Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>

      <div className="tabular mt-2 flex items-baseline justify-between text-xs">
        <span className="text-ink">
          {formatBytes(data.usedBytes)}
          <span className="text-faint"> of {formatBytes(data.limitBytes)}</span>
        </span>
        <span className={data.hasRoom ? 'text-muted' : 'text-amber'}>
          {percent === null ? 'quota unknown' : `${formatBytes(data.freeBytes)} free`}
        </span>
      </div>

      {tone?.note && <p className={`mt-2 text-[11px] ${tone.text}`}>{tone.note}</p>}
    </div>
  );
}
