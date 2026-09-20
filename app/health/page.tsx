import { Suspense } from 'react';
import { fetchStats } from '@/lib/appsScript';
import { RetryButton } from '@/components/RetryButton';

// The unmatched list is a work queue reviewed in sittings, not a live feed.
export const revalidate = 60;

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-raised px-1 py-0.5 font-mono text-[11px] text-accent">{children}</code>
);

// Not every unmatched row is the same problem, and a flat list of 128 hides
// that. Measured against the live sheet:
//
//   112  a plausible tracking ID Shopify did not match — what repair can fix
//     7  UNKNOWN-<timestamp>: the scanner never read a barcode, so there is no
//        tracking number to look up. Re-running repair can never help these.
//     5  too short to be a tracking ID ("Z01", "JGB", "3104")
//     3  an ORDER number typed into the tracking field ("Dropy-1551")
//     1  __DROPPYTEST__
//
// Those last 16 will never match however often the repair job runs, so they are
// split out: leaving them mixed in makes the fixable backlog look bigger than
// it is and sends people chasing rows that have no answer.
type Bucket = 'fixable' | 'noBarcode' | 'wrongField' | 'malformed' | 'test';

function classify(trackingId: string): Bucket {
  if (trackingId === '__DROPPYTEST__') return 'test';
  if (trackingId.startsWith('UNKNOWN-')) return 'noBarcode';
  if (/^#?Dropy-\d+$/i.test(trackingId)) return 'wrongField';
  if (trackingId.length <= 4) return 'malformed';
  return 'fixable';
}

const BUCKET_META: Record<Bucket, { label: string; hint: string; tone: 'bad' | 'warn' | 'neutral' }> = {
  fixable: {
    label: 'Awaiting a Shopify match',
    hint: 'Real tracking IDs — these are what repairDeliveryRows() can fix.',
    tone: 'bad'
  },
  noBarcode: {
    label: 'Scanner read no barcode',
    hint: 'Logged as UNKNOWN-<timestamp>; there is no tracking number to look up.',
    tone: 'warn'
  },
  wrongField: {
    label: 'Order number in the tracking field',
    hint: 'An order name was entered where a tracking ID belongs.',
    tone: 'warn'
  },
  malformed: {
    label: 'Too short to be a tracking ID',
    hint: 'Partial scans — the parcel needs re-scanning against its label.',
    tone: 'warn'
  },
  test: { label: 'Test rows', hint: 'Safe to delete from the sheet.', tone: 'neutral' }
};

const ORDER: Bucket[] = ['fixable', 'noBarcode', 'wrongField', 'malformed', 'test'];

async function UnmatchedRows() {
  const stats = await fetchStats();

  if (!stats.success) {
    return (
      <div className="rounded-xl border border-amber/30 bg-panel p-4 shadow-card">
        <div className="text-sm font-medium text-ink">Sheet stats unavailable</div>
        <p className="mt-1 text-xs text-muted">
          {stats.error ?? 'The summary endpoint did not respond this time — the sheet itself is fine.'}
        </p>
        <RetryButton />
      </div>
    );
  }

  if (stats.blankOrderNameRows.length === 0) {
    return (
      <div className="rounded-xl border border-teal/30 bg-teal/[0.04] p-4 shadow-card">
        <div className="text-sm font-medium text-teal">No unmatched rows</div>
        <p className="mt-1 text-xs text-muted">Every row currently has a verified Order Name from Shopify.</p>
      </div>
    );
  }

  // Entries are "<sheetRow>:<trackingId>". Split on the FIRST colon only — a
  // tracking ID containing a colon would otherwise lose its tail.
  const parsed = stats.blankOrderNameRows.map((entry) => {
    const idx = entry.indexOf(':');
    const row = idx === -1 ? '?' : entry.slice(0, idx);
    const trackingId = idx === -1 ? entry : entry.slice(idx + 1);
    return { row, trackingId, bucket: classify(trackingId) };
  });

  const groups = ORDER.map((b) => ({ bucket: b, rows: parsed.filter((p) => p.bucket === b) })).filter(
    (g) => g.rows.length > 0
  );

  const truncated = stats.blankOrderNameRows.length < stats.blankOrderName;
  const neverMatch = parsed.filter((p) => p.bucket !== 'fixable').length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-panel px-4 py-3 shadow-card">
        <span className="tabular text-sm">
          <b className="text-ink">{stats.blankOrderName}</b> <span className="text-muted">unmatched rows</span>
        </span>
        <span className="tabular text-sm text-red">{parsed.length - neverMatch} fixable by repair</span>
        <span className="tabular text-sm text-muted">{neverMatch} need a human</span>
        {truncated && <span className="text-[11px] text-faint">showing first {stats.blankOrderNameRows.length}</span>}
      </div>

      {groups.map(({ bucket, rows }) => {
        const meta = BUCKET_META[bucket];
        const accent = meta.tone === 'bad' ? 'text-red' : meta.tone === 'warn' ? 'text-amber' : 'text-muted';
        return (
          <section key={bucket}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className={`text-sm font-semibold ${accent}`}>
                {meta.label} <span className="tabular font-normal text-faint">· {rows.length}</span>
              </h2>
              <p className="text-xs text-faint">{meta.hint}</p>
            </div>

            {/* Dense multi-column grid: one 128-row column meant endless
                scrolling while ~90% of a wide screen sat empty. */}
            <ul className="mt-2 grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-panel shadow-card sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {rows.map(({ row, trackingId }) => (
                <li
                  key={`${row}:${trackingId}`}
                  className="tabular flex items-baseline justify-between gap-3 border-b border-border px-3 py-1.5 text-xs transition-colors hover:bg-raised"
                >
                  <span className="shrink-0 text-faint">{row}</span>
                  <span className="truncate font-medium text-ink" title={trackingId}>
                    {trackingId}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-panel shadow-card">
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="h-2.5 w-10 animate-pulse rounded bg-raised" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-raised" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HealthPage() {
  return (
    <div className="w-full">
      <h1 className="text-lg font-semibold text-ink">Health</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Rows missing an Order Name — usually means Shopify did not return a verified match for that tracking ID
        (see <Code>fetchShopifyOrderByTracking</Code> in your Code.gs).
      </p>

      <section className="mt-6">
        <Suspense fallback={<RowsSkeleton />}>
          <UnmatchedRows />
        </Suspense>
      </section>

      <p className="mt-6 max-w-3xl text-xs text-muted">
        To fix these: run <Code>repairDeliveryRows()</Code> from the Apps Script editor, or hit{' '}
        <Code>?action=admin&amp;job=repair</Code> — both re-check against Shopify and only overwrite rows that turn
        out wrong. Repair needs a working Shopify token; while the token is rejected it will fix nothing.
      </p>
    </div>
  );
}
