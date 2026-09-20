'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeliveryRow } from '@/lib/appsScript';
import { AssignOrder } from '@/components/AssignOrder';
import { CopyValue } from '@/components/CopyValue';
import { ItemsCell } from '@/components/ItemsCell';
import { MediaCell } from '@/components/MediaCell';
import { MediaViewer } from '@/components/MediaViewer';
import { addedAt, formatDateTime, formatRelative, orderMatches, statusAt } from '@/lib/media';

// Two different data-loading modes, picked automatically:
//
// BROWSE (no search/filter active) — real server-side pages of BROWSE_PAGE_SIZE
// rows, fetched on demand as you click Prev/Next. Fast: one small request per
// page, nothing else loaded.
//
// SEARCH (any filter active) — dashboardData has no search of its own, so the
// only way to search correctly is to have every row in memory. The moment a
// filter becomes active, this fetches the first SEARCH_FETCH_CHUNK rows alone
// (fast first result + learns totalRows), then the rest 3-at-a-time with
// retry-on-failure (see fetchDeliveriesWithRetry / runWithConcurrency) — fully
// parallel caused real 502s from Apps Script-side contention, fully sequential
// was reliable but ~4x slower than needed. Results stream into the table as
// each chunk lands, so a match near the front of the sheet shows up almost
// immediately even while later chunks are still loading. Clearing every
// filter switches back to BROWSE and drops the full copy, so idle browsing
// stays cheap.
const BROWSE_PAGE_SIZE = 20;
const SEARCH_FETCH_CHUNK = 500;

// Delivered/failed/pending is the signal that actually matters at a glance —
// keep that 3-way grouping as the text color. A colored dot (below) carries
// the finer distinction between e.g. two different "Shipped · X" variants,
// so the two encodings don't fight each other.
// Delivered / in-transit / failed / pending is the signal that actually matters
// at a glance. Returns a full badge treatment rather than a bare text color:
// on a dense table, colored text alone is easy to miss, while a tinted pill
// reads as a status even in peripheral vision.
// Color is decided from the SHIPPING state only — i.e. the part before the
// "·" — never from the payment qualifier after it.
//
// Two bugs this fixes, both found against the live sheet's real 8 statuses:
//   "Shipped · Payment Pending"     was amber, because "pending" (a PAYMENT
//                                   fact) outranked "shipped". Two parcels
//                                   both in transit showed different colors.
//   "Shipped · Partially Refunded"  contains "refund", which nearly matched
//                                   the returned/RTO red rule.
// Payment state is real information, but it belongs in the qualifier line, not
// in the color that answers "where is this parcel?".
function statusStyle(status: string): string {
  const s = splitStatus(status).main.toLowerCase();
  if (s.startsWith('delivered')) return 'border-teal/30 bg-teal/10 text-teal';
  if (/fail|cancel|rto|returned|undeliver/.test(s)) return 'border-red/30 bg-red/10 text-red';
  if (/attempted|hold|exception|delay/.test(s)) return 'border-amber/30 bg-amber/10 text-amber';
  if (/shipped|transit|out for|dispatch/.test(s)) return 'border-violet/30 bg-violet/10 text-violet';
  if (/confirmed|packed|ready|pending/.test(s)) return 'border-border-strong bg-raised text-muted';
  return 'border-border bg-raised text-muted';
}

// Payment qualifiers carry their own quiet tone, so "Payment Pending" still
// reads as needing attention without stealing the shipping color.
function qualifierTone(qualifier: string): string {
  const q = qualifier.toLowerCase();
  if (/pending|unpaid/.test(q)) return 'text-amber';
  if (/refund/.test(q)) return 'text-red';
  return 'text-faint';
}

// A status like "Shipped · Partially Paid" is really two facts. Splitting on
// the separator lets the primary state carry the badge while the qualifier
// sits underneath in quiet text, instead of wrapping into a ragged two-line
// cell that made every row a different height.
function splitStatus(status: string): { main: string; qualifier: string | null } {
  // U+FFFD is included deliberately: the sheet's middot sometimes arrives
  // mis-encoded and rendered as a black-diamond replacement character, and
  // the status still has to split into shipping vs payment halves.
  const parts = status.split(/\s*[\u00b7\u2022\ufffd|]\s*/);
  return { main: parts[0] || status, qualifier: parts.length > 1 ? parts.slice(1).join(' · ') : null };
}

function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-faint">—</span>;
  const { main, qualifier } = splitStatus(status);
  return (
    <span className="flex flex-col items-start gap-0.5" title={status}>
      <span
        className={`inline-block max-w-full rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight ${statusStyle(status)}`}
      >
        {main}
      </span>
      {qualifier && <span className={`text-[10px] leading-tight ${qualifierTone(qualifier)}`}>{qualifier}</span>}
    </span>
  );
}

// A small fixed palette of dot colors, cycled by a stable hash of the value.
// Used only for open-ended per-value identity coding (which Drive account a
// row lives in) — never for status, which has real semantic colors above.
const DOT_COLORS = [
  '#5EEAD4', '#F0B429', '#F472B6', '#60A5FA', '#A78BFA',
  '#34D399', '#FB923C', '#38BDF8', '#F87171', '#C084FC'
];

function hashColor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return DOT_COLORS[h % DOT_COLORS.length];
}

function Dot({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: hashColor(value) }}
      aria-hidden
    />
  );
}

// driveAccount is a full email; showing it in full at typical dashboard
// widths pushes later columns off-screen. Show just the local part, full
// address on hover via title.
function shortAccount(email: string): string {
  if (!email) return '—';
  return email.split('@')[0];
}

const DATE_RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '1', label: 'Last 24h' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' }
] as const;

type TableQuery = {
  q?: string;
  status?: string;
  account?: string;
  days?: number;
  sort?: string;
  dir?: 'asc' | 'desc';
};

async function fetchDeliveries(
  offset: number,
  limit: number,
  query: TableQuery = {}
): Promise<{
  rows: DeliveryRow[];
  hasMore: boolean;
  totalRows: number;
  /** Rows the query can page through — the match count when q was applied. */
  matchCount?: number;
  /** True when the server filtered rather than returning a plain page. */
  searched?: boolean;
}> {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.account) params.set('account', query.account);
  if (query.days) params.set('days', String(query.days));
  if (query.sort) {
    params.set('sort', query.sort);
    params.set('dir', query.dir ?? 'desc');
  }

  const res = await fetch(`/api/deliveries?${params}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error ?? 'Failed to load');
  return {
    rows: data.rows,
    hasMore: data.hasMore,
    totalRows: data.totalRows,
    matchCount: data.matchCount,
    searched: data.searched
  };
}

// One retry on failure — measured against the live endpoint: firing all
// chunks in parallel with no cap causes real 502s (Apps Script's own
// concurrent-execution/lock contention), but a failed chunk almost always
// succeeds on an immediate retry once the contention clears. Small backoff
// so a retry doesn't just re-collide with the same contention.
async function fetchDeliveriesWithRetry(offset: number, limit: number) {
  try {
    return await fetchDeliveries(offset, limit);
  } catch {
    await new Promise((r) => setTimeout(r, 500));
    return fetchDeliveries(offset, limit);
  }
}

// Runs async tasks with at most `concurrency` in flight at once. Confirmed
// against the live dashboardData endpoint: firing every chunk at once (no
// cap) triggers 502s from contention; 2 at a time is fast (~2x sequential,
// not 1x) while staying reliable — the middle ground between "safe but slow"
// (fully sequential) and "fast but flaky" (fully parallel).
async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number, onResult: (t: T) => void) {
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      onResult(await tasks[i]());
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}

/**
 * A clickable column header.
 *
 * Sorting runs on the server across every matching row, so this is a real sort
 * of 2,535 deliveries rather than a reshuffle of the twenty on screen. The
 * caret shows direction; a third click clears it and returns to sheet order.
 */
function SortHeader({
  label,
  by,
  sort,
  onSort,
  align = 'left'
}: {
  label: string;
  by: string;
  sort: { by: string; dir: 'asc' | 'desc' } | null;
  onSort: (by: string) => void;
  align?: 'left' | 'right';
}) {
  const active = sort?.by === by;
  return (
    <button
      type="button"
      onClick={() => onSort(by)}
      title={
        active
          ? sort?.dir === 'desc'
            ? `Sorted high to low — click for low to high`
            : `Sorted low to high — click to clear`
          : `Sort by ${label.toLowerCase()}`
      }
      className={`group/sort flex w-full items-center gap-1 ${align === 'right' ? 'justify-end' : ''} ${
        active ? 'text-accent' : 'hover:text-ink'
      }`}
    >
      <span>{label}</span>
      <span
        aria-hidden
        className={`text-[9px] leading-none transition-opacity ${
          active ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-50'
        }`}
      >
        {active && sort?.dir === 'asc' ? '▲' : '▼'}
      </span>
    </button>
  );
}

export function DeliveryTable() {
  // BROWSE mode state — one page of BROWSE_PAGE_SIZE rows at a time.
  const [browseRows, setBrowseRows] = useState<DeliveryRow[]>([]);
  const [browsePage, setBrowsePage] = useState(0); // 0-based
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseTotal, setBrowseTotal] = useState<number | null>(null);
  const [browseLoading, setBrowseLoading] = useState(true);

  // SEARCH mode state — the full dataset, fetched once in chunks, kept until
  // every filter is cleared.
  // The separate "search mode" state is gone with the whole-sheet download:
  // there is one path now, and the server answers it.

  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [dateRange, setDateRange] = useState<(typeof DATE_RANGE_OPTIONS)[number]['value']>('all');
  const [expandedItems, setExpandedItems] = useState<string | null>(null);
  const [viewingMedia, setViewingMedia] = useState<DeliveryRow | null>(null);
  // Which row the operator is currently working on. Clicking anywhere on a row
  // selects it — with ~20 wide rows on screen, losing your place while reading
  // across to the Items column is the easiest mistake to make here.
  const [selected, setSelected] = useState<string | null>(null);

  // Sorting is done by the server across ALL matching rows, not by the browser
  // across the twenty on screen. Sorting a single page would silently answer
  // "the largest order on page 1", which on a 127-page table is not the
  // question anyone is asking.
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' } | null>(null);

  function toggleSort(by: string) {
    setSort((cur) => {
      if (cur?.by !== by) return { by, dir: 'desc' };
      // Third click clears it, back to sheet order (newest first) — otherwise
      // there is no way back without reloading.
      if (cur.dir === 'desc') return { by, dir: 'asc' };
      return null;
    });
    setBrowsePage(0);
  }

  // Tracking IDs that have a dispatch scan.
  //
  // One call for the whole set, kept as a Set for O(1) lookup per row — a
  // request per row would be ~20 two-sheet joins per page. Null until it
  // arrives, which is distinct from "loaded and empty": before it lands no row
  // can be called an audit gap, and claiming otherwise would flag every
  // delivery on the page.
  const [dispatchedIds, setDispatchedIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Deferred, not fired on mount.
    //
    // This walks the whole Dispatch sheet and measures ~7.7s. Competing with
    // the row fetch for the browser's connection made the table itself slower,
    // to fill a column that most rows no longer need: dashboardData now returns
    // `Dispatched At` directly, and this is only the fallback for rows written
    // before that column existed. Letting the rows land first costs those older
    // rows a second of "unknown" and makes the page usable immediately.
    const started = setTimeout(() => {
      fetch('/api/dispatch-ids')
        .then((r) => r.json())
        .then((d) => {
        // An empty or absent Dispatch sheet is a normal first-run state, so a
        // failure here leaves the column silent rather than showing an error
        // on a page that is otherwise fine.
          if (!cancelled && d.success) setDispatchedIds(new Set<string>(d.ids ?? []));
        })
        .catch(() => {});
    }, 1200);

    return () => {
      cancelled = true;
      clearTimeout(started);
    };
  }, []);

  // A typed query is now answered by the SERVER, which scans the sheet once and
  // returns only matches (~3s). It used to be answered by downloading all 2,528
  // rows in 500-row chunks at ~5s each, so a search took 15-25 seconds and
  // showed "no match yet" for most of it.
  //
  // The dropdowns still filter in memory, because they operate on whatever set
  // is on screen — including a set the server just searched.
  const trimmedQuery = query.trim();

  // Debounced so a query is sent once the operator stops typing, not on every
  // keystroke: a 12-character tracking number would otherwise fire 12 scans of
  // the whole sheet.
  const [activeQuery, setActiveQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setActiveQuery(trimmedQuery), 350);
    return () => clearTimeout(id);
  }, [trimmedQuery]);

  const hasDropdownFilters = statusFilter !== 'all' || accountFilter !== 'all' || dateRange !== 'all';
  const hasActiveFilters = Boolean(trimmedQuery || hasDropdownFilters);

  // The whole query, in one object, so the fetch effect has a single dependency
  // and cannot fall out of step with what the toolbar shows.
  const serverQuery: TableQuery = {
    q: activeQuery || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
    account: accountFilter !== 'all' ? accountFilter : undefined,
    days: dateRange !== 'all' ? Number(dateRange) : undefined,
    sort: sort?.by,
    dir: sort?.dir
  };
  const queryKey = JSON.stringify(serverQuery);

  // Paged fetch. Serves plain browsing AND a typed search — the only difference
  // is whether `q` goes along, and the server pages the matches the same way it
  // pages the sheet. The whole-sheet download only survives for the dropdown
  // filters below.
  useEffect(() => {
    let cancelled = false;
    setBrowseLoading(true);
    fetchDeliveries(browsePage * BROWSE_PAGE_SIZE, BROWSE_PAGE_SIZE, serverQuery)
      .then((data) => {
        if (cancelled) return;
        setBrowseRows(data.rows);
        setBrowseHasMore(data.hasMore);
        // When searching, pagination counts MATCHES; the sheet total stays in
        // the stat tiles where it belongs.
        setBrowseTotal(data.searched ? (data.matchCount ?? data.rows.length) : data.totalRows);
        setError(null);
      })
      .catch((err) => !cancelled && setError(String(err)))
      .finally(() => !cancelled && setBrowseLoading(false));
    return () => {
      cancelled = true;
    };
    // queryKey, not the object: a fresh object each render would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsePage, queryKey]);

  // SEARCH fetch — kicks in the moment a filter becomes active, and pulls
  // everything in SEARCH_FETCH_CHUNK-row calls until the whole sheet is in
  // memory. Only runs once per "session" of having a filter active — it does
  // NOT re-run on every keystroke, since it's fetching ALL rows regardless of
  // the query text (the query itself is applied client-side afterward).
  //
  // Bug this fixes: this effect used to depend on [hasActiveFilters,
  // allRows.length]. setAllRows() is called after every chunk to stream
  // progress in, which changed allRows.length and re-ran the effect mid-fetch
  // — React's cleanup then set `cancelled = true` on the in-flight loop,
  // silently killing it partway through (observed: it always stopped after
  // exactly 2 of 4 chunks). A ref tracks "a fetch for this filter session has
  // started" without being a reactive dependency, so streaming progress in no
  // longer restarts/cancels the effect that's doing the streaming.
  // A new query restarts paging: staying on page 7 would ask the server for a
  // page the new result set may not have.
  useEffect(() => {
    setBrowsePage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  // The whole-sheet download is gone.
  //
  // Selecting a dropdown used to pull every row into the browser — 2,535 rows
  // in 500-row chunks at ~3.6s each, so picking "Delivered" cost 15-20 seconds
  // and showed "no match yet" for most of it. dashboardData now filters and
  // sorts server-side, which measures ~3s, because it already holds the sheet
  // in memory when the request arrives.

  // Distinct statuses/accounts for the filter dropdowns — sourced from
  // whichever rows are currently in memory (browse page or full search set).
  // Options are drawn from the rows on screen. The selected value is added
  // back in explicitly, because once a filter is applied the server returns
  // only matching rows — without this the active choice would vanish from its
  // own dropdown.
  const optionSource = browseRows;
  const statusOptions = useMemo(() => {
    const set = new Set(optionSource.map((r) => r.deliveryStatus).filter(Boolean));
    if (statusFilter !== 'all') set.add(statusFilter);
    return Array.from(set).sort();
  }, [optionSource, statusFilter]);
  const accountOptions = useMemo(() => {
    const set = new Set(optionSource.map((r) => r.driveAccount).filter(Boolean));
    if (accountFilter !== 'all') set.add(accountFilter);
    return Array.from(set).sort();
  }, [optionSource, accountFilter]);

  // No client-side filtering left: the server returned exactly the rows that
  // match, already sorted and already paged.
  const filtered = browseRows;

  // In search mode, paginate the (already filtered) in-memory results at the
  // same page size browse mode uses, so the table always shows ~20 rows.
  // One page model: the server reports matchCount, and browseTotal already
  // holds it.
  const pageRows = filtered;

  // After a successful assign, patch that row in whichever list is on screen
  // rather than refetching the page: the sheet write has already happened, and
  // a refetch would cost another multi-second round trip just to change one
  // cell. The full row (customer, items, status) fills in on the next natural
  // load — the assign endpoint writes all of it server-side.
  function onAssigned(trackingId: string, orderName: string) {
    const patch = (rows: DeliveryRow[]) =>
      rows.map((row) => (row.trackingId === trackingId ? { ...row, orderName } : row));
    setBrowseRows(patch);
  }

  function clearFilters() {
    setQuery('');
    setStatusFilter('all');
    setAccountFilter('all');
    setDateRange('all');
  }

  function onFilterChange<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      // Back to page 1: page 4 of the old result set may not exist in the new.
      setBrowsePage(0);
    };
  }

  const setQueryAndResetPage = onFilterChange(setQuery);
  const setStatusFilterAndResetPage = onFilterChange(setStatusFilter);
  const setAccountFilterAndResetPage = onFilterChange(setAccountFilter);
  const setDateRangeAndResetPage = onFilterChange(setDateRange);

  const isSearchStillLoading = false;

  return (
    <div>
      {/* Filters live in a toolbar, not inside <th>s. Inline selects made every
          header a different height and pushed the column labels out of
          alignment with the data underneath; here they read as one control
          group and the table header goes back to being just labels. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-panel px-3 py-3 shadow-card">
        <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
          <span className="text-[11px] uppercase tracking-wide text-faint">Search</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQueryAndResetPage(e.target.value)}
            placeholder="Tracking ID, order, customer, or items…"
            className="w-full min-w-[220px] rounded-lg border border-border bg-panel px-3 py-1.5 text-sm text-ink shadow-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilterAndResetPage(e.target.value)}
            className="w-40 rounded-lg border border-border bg-panel px-2 py-1.5 text-xs text-ink shadow-sm focus:border-accent focus:outline-none"
          >
            <option value="all">All statuses</option>
            {statusOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Drive account</span>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilterAndResetPage(e.target.value)}
            className="w-40 rounded-lg border border-border bg-panel px-2 py-1.5 text-xs text-ink shadow-sm focus:border-accent focus:outline-none"
          >
            <option value="all">All accounts</option>
            {accountOptions.map((a) => (
              <option key={a} value={a}>
                {shortAccount(a)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Added</span>
          <select
            value={dateRange}
            onChange={(e) => setDateRangeAndResetPage(e.target.value as typeof dateRange)}
            className="w-32 rounded-lg border border-border bg-panel px-2 py-1.5 text-xs text-ink shadow-sm focus:border-accent focus:outline-none"
          >
            {DATE_RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-lg border border-border bg-panel px-2.5 py-1.5 text-xs text-muted shadow-sm transition-colors hover:border-border-strong hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>

      {/* Searching means pulling the WHOLE sheet (dashboardData has no search of
          its own) — measured at ~5s per 500-row chunk against the live endpoint,
          so ~10-15s for 2.5k rows. A determinate bar makes that wait legible
          instead of looking hung, and matches stream in as chunks land. */}
      {error && <p className="mb-3 mt-3 text-sm text-red">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-panel shadow-card">
        <table className="w-full min-w-[940px] table-fixed text-left text-sm lg:min-w-0">
          {/* Proportional widths, not fixed pixels.
              Fixed px plus a 1240px min-width meant the table never fit the
              viewport, so it lived permanently inside a horizontal scroller
              and the first column read as clipped. Percentages divide the
              width that actually exists; the min-width is now only the point
              where content genuinely stops fitting. */}
          <colgroup>
            <col className="w-[9%]" />{/* Media — 2 thumbs + overflow badge */}
            <col className="w-[7%]" />{/* Dispatch — scanned out of the warehouse? */}
            <col className="w-[9%]" />{/* Tracking ID */}
            <col className="w-[8%]" />{/* Order */}
            <col className="w-[9%]" />{/* Customer */}
            <col className="w-[8%]" />{/* Status — wraps rather than clipping */}
            <col className="w-[7%]" />{/* Status changed */}
            <col className="w-[7%]" />{/* Drive account */}
            <col className="w-[7%]" />{/* Added */}
            <col className="w-[6%]" />{/* Total */}
            <col />{/* Items — whatever remains */}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-raised text-[11px] uppercase tracking-wide text-faint">
              <th className="px-3 py-2.5 font-medium">Media</th>
              <th className="px-3 py-2.5 font-medium">Dispatch</th>
              <th className="px-3 py-2.5 font-medium">Tracking ID</th>
              <th className="px-3 py-2.5 font-medium">Order</th>
              <th className="px-3 py-2.5 font-medium"><SortHeader label="Customer" by="customer" sort={sort} onSort={toggleSort} /></th>
              <th className="px-3 py-2.5 font-medium"><SortHeader label="Status" by="status" sort={sort} onSort={toggleSort} /></th>
              <th className="px-3 py-2.5 font-medium">Status changed</th>
              <th className="px-3 py-2.5 font-medium">Drive account</th>
              <th className="px-3 py-2.5 font-medium"><SortHeader label="Added" by="added" sort={sort} onSort={toggleSort} /></th>
              <th className="px-3 py-2.5 font-medium"><SortHeader label="Total" by="total" sort={sort} onSort={toggleSort} align="right" /></th>
              <th className="px-3 py-2.5 font-medium">Items</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const isExpanded = expandedItems === r.trackingId;
              // A row with media but no Shopify fields at all: the upload
              // happened, but no order was ever matched to it. Every text cell
              // would otherwise render as a bare "—" with nothing saying why.
              const isUnmatched = !r.orderName && !r.deliveryStatus && !r.customerName;
              // An order number recorded without a Shopify lookup: the Order
              // column is filled but customer, items, price and status are all
              // still empty. Three such rows exist live. Left unmarked they
              // read as resolved while holding nothing, which is worse than an
              // obviously unmatched row — you would never know to re-run
              // repair on them.
              const isUnverified =
                !isUnmatched && Boolean(r.orderName) && !r.customerName && !r.deliveryStatus;
              // Selected, or the row whose media is open — both mean "this is the
              // one I'm looking at", so they share the highlight.
              const isSelected = selected === r.trackingId || viewingMedia?.trackingId === r.trackingId;
              return (
                <tr
                  key={r.trackingId}
                  onClick={() => setSelected(r.trackingId)}
                  aria-selected={isSelected}
                  className={`relative cursor-default border-b border-border transition-colors last:border-0 ${
                    isSelected
                      ? // The left rail is what actually marks the row: a background
                        // tint alone competes with the unmatched row's red tint and
                        // with hover, so a selected unmatched row read as neither.
                        'bg-accent/[0.07] shadow-[inset_3px_0_0_0_theme(colors.accent)]'
                      : isUnmatched
                        ? 'bg-red/[0.03] hover:bg-raised'
                        : isUnverified
                          ? 'bg-amber/[0.04] hover:bg-raised'
                          : 'hover:bg-raised'
                  }`}
                >
                  <td className="px-3 py-2">
                    <MediaCell
                      row={r}
                      onOpen={(row) => {
                        setSelected(row.trackingId);
                        setViewingMedia(row);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    {/* Three states, and the third is not "no": until the id
                        set loads, nothing is known, and marking a row as an
                        audit gap on missing data would flag every row. */}
                    {/* The sheet's own Dispatched At wins when present: it is
                        written at scan time and needs no join. Blank means
                        "unknown" on a row predating the column, NOT "never
                        dispatched" — so it falls through to the id set, which
                        is the only thing that can assert an audit gap. */}
                    {r.dispatchedAt ? (
                      <span
                        className="inline-block whitespace-nowrap rounded-full border border-teal/30 bg-teal/10 px-2 py-0.5 text-[11px] text-teal"
                        title={`Scanned out ${r.dispatchedAt}`}
                      >
                        scanned
                      </span>
                    ) : dispatchedIds === null ? (
                      <span className="inline-block h-3 w-10 animate-pulse rounded bg-raised" aria-hidden />
                    ) : dispatchedIds.has(r.trackingId) ? (
                      <span
                        className="inline-block whitespace-nowrap rounded-full border border-teal/30 bg-teal/10 px-2 py-0.5 text-[11px] text-teal"
                        title="Scanned out of the warehouse before delivery"
                      >
                        scanned
                      </span>
                    ) : (
                      <span
                        className="inline-block whitespace-nowrap rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[11px] text-amber"
                        title="Delivered with no dispatch scan — the door scan was skipped, or a different label was scanned. A process gap, not a lost parcel."
                      >
                        no scan
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 font-medium text-ink">
                    <CopyValue value={r.trackingId} title="Tracking ID" />
                  </td>
                  <td className="px-3 py-2 text-ink">
                    {r.orderName ? (
                      <span className="flex flex-col leading-tight">
                        <CopyValue value={r.orderName} title="Order" className="text-ink" />
                        {isUnverified && (
                          <span
                            className="text-[10px] text-amber"
                            title="Recorded without a Shopify lookup — customer, items and price are still missing. Run repairDeliveryRows() to fill them in."
                          >
                            unverified
                          </span>
                        )}
                      </span>
                    ) : isUnmatched ? (
                      <AssignOrder trackingId={r.trackingId} onAssigned={onAssigned} />
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {r.customerName ? (
                      <CopyValue value={r.customerName} title="Customer" />
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.deliveryStatus} />
                  </td>
                  <td className="tabular px-3 py-2 text-xs">
                    {(() => {
                      const d = statusAt(r);
                      // Unparseable-but-present stamps still show their raw text —
                      // "—" would wrongly read as "no status date at all".
                      if (!d) return <span className="text-faint">{r.statusDate || '—'}</span>;
                      return (
                        <span className="flex flex-col leading-tight">
                          <span className="whitespace-nowrap text-muted">{formatDateTime(d)}</span>
                          <span className="text-[10px] text-faint">{formatRelative(d)}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted" title={r.driveAccount}>
                    <span className="flex items-center gap-1.5">
                      <Dot value={r.driveAccount} />
                      {shortAccount(r.driveAccount)}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-xs">
                    {(() => {
                      const d = addedAt(r);
                      if (!d) return <span className="text-faint">{r.createdDate || '—'}</span>;
                      return (
                        <span className="flex flex-col leading-tight" title={`Packed ${d.toLocaleString()}`}>
                          <span className="whitespace-nowrap text-muted">{formatDateTime(d)}</span>
                          <span className="text-[10px] text-faint">{formatRelative(d)}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="tabular whitespace-nowrap px-3 py-2 text-right text-ink">
                    {(() => {
                      if (!r.totalPrice) return <span className="text-faint">—</span>;
                      // "INR 12449.0" — currency is repeated on every row, so it
                      // recedes and the amount (the part you compare) stays ink.
                      const m = r.totalPrice.match(/^([A-Za-z]{3})\s*(.+)$/);
                      return m ? (
                        <span>
                          <span className="mr-1 text-[10px] text-faint">{m[1]}</span>
                          {m[2]}
                        </span>
                      ) : (
                        r.totalPrice
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 align-top text-muted">
                    <ItemsCell
                      items={r.items}
                      expanded={isExpanded}
                      onToggle={() => setExpandedItems(isExpanded ? null : r.trackingId)}
                    />
                  </td>
                </tr>
              );
            })}
            {/* Skeleton rows while the first page is in flight — a sized,
                shaped placeholder tells you the table is coming and stops the
                page height from jumping when rows land. A bare "Loading…" in
                an empty frame did neither. */}
            {pageRows.length === 0 && browseLoading && !hasDropdownFilters &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="h-9 w-9 animate-pulse rounded bg-raised" />
                  </td>
                  {Array.from({ length: 10 }).map((__, c) => (
                    <td key={c} className="px-3 py-2">
                      <div
                        className="h-3 animate-pulse rounded bg-raised"
                        style={{ width: `${[40, 70, 55, 60, 50, 65, 45, 60, 40, 80][c]}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))}

            {pageRows.length === 0 && !(browseLoading && !hasDropdownFilters) && (
              <tr>
                <td colSpan={11} className="px-3 py-12 text-center">
                  {hasActiveFilters ? (
                    <>
                      <div className="text-sm text-ink">No deliveries match these filters.</div>
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="mt-2 text-xs text-accent hover:underline"
                      >
                        Clear all filters
                      </button>
                    </>
                  ) : (
                    <div className="text-sm text-muted">No deliveries.</div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 2.5k rows = ~126 pages. Prev/Next alone meant no way to reach the end
          or return to a known page, so first/last jumps and a direct page input
          sit alongside them. Browse mode's input refetches from the server;
          search mode slices rows already in memory. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(() => {
          // One page model. browseTotal is matchCount when anything is
          // filtered and the sheet total otherwise, so the same arithmetic
          // works either way and there is no second mode to keep in step.
          const page = browsePage;
          const pageCount = browseTotal !== null ? Math.max(1, Math.ceil(browseTotal / BROWSE_PAGE_SIZE)) : null;
          const setPage = (p: number) => {
            const next = pageCount ? Math.max(0, Math.min(pageCount - 1, p)) : Math.max(0, p);
            setBrowsePage(next);
          };
          const busy = browseLoading;
          const atStart = page === 0;
          const atEnd = !browseHasMore;
          const btn =
            'rounded-lg border border-border bg-panel px-2.5 py-1.5 text-xs text-ink shadow-sm transition-colors hover:border-border-strong hover:bg-raised disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-panel';

          return (
            <>
              <button onClick={() => setPage(0)} disabled={busy || atStart} className={btn} title="First page">
                «
              </button>
              <button onClick={() => setPage(page - 1)} disabled={busy || atStart} className={btn}>
                ← Prev
              </button>
              <button onClick={() => setPage(page + 1)} disabled={busy || atEnd} className={btn}>
                Next →
              </button>
              {pageCount !== null && (
                <button
                  onClick={() => setPage(pageCount - 1)}
                  disabled={busy || atEnd}
                  className={btn}
                  title="Last page"
                >
                  »
                </button>
              )}

              <span className="tabular ml-1 flex items-center gap-1.5 text-xs text-muted">
                <span className="text-faint">Page</span>
                <input
                  type="number"
                  min={1}
                  max={pageCount ?? undefined}
                  value={page + 1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 1) setPage(v - 1);
                  }}
                  className="w-14 rounded-lg border border-border bg-panel px-1.5 py-1 text-center text-xs text-ink shadow-sm focus:border-accent focus:outline-none"
                  aria-label="Go to page"
                />
                {pageCount !== null && <span className="text-faint">of {pageCount}</span>}
              </span>

              <span className="tabular text-xs text-faint">
                {browseTotal !== null
                  ? `${browseTotal.toLocaleString()} ${hasActiveFilters ? 'matching ' : ''}deliver${
                      browseTotal === 1 ? 'y' : 'ies'
                    }`
                  : ''}
              </span>
              {busy && <span className="text-xs text-faint">loading…</span>}
            </>
          );
        })()}
      </div>

      {viewingMedia && <MediaViewer row={viewingMedia} onClose={() => setViewingMedia(null)} />}
    </div>
  );
}
