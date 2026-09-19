'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { CopyValue } from '@/components/CopyValue';
import { ItemsCell } from '@/components/ItemsCell';
import type { DispatchListResponse, DispatchRow, DispatchStatus } from '@/lib/appsScript';

// The dispatch chase list.
//
// Deliberately the same shape as DeliveryTable — same page size, same toolbar,
// same pagination controls, same skeleton — because this is one product with
// two views, not a second app bolted on.
//
// Every filter round-trips to the server. Filtering a partial page in the
// browser would silently answer "what matched on page 1", which on a chase list
// is worse than no filter: it reports an empty queue that is not empty.

const PAGE_SIZE = 20;

const STATUS_OPTIONS: Array<{ value: DispatchStatus; label: string }> = [
  // Outstanding first, and the default: someone opening this page almost always
  // wants the chase list, not a full history.
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'all', label: 'All' }
];

function formatStamp(raw: string): { date: string; relative: string } {
  if (!raw) return { date: '—', relative: '' };

  // Two formats arrive from the sheet and both must work:
  //   "2026-09-19 15:31:10"                      the documented form
  //   "Sat Sep 19 2026 15:44:10 GMT+0530 (…)"    what the live sheet returns
  //
  // Only the first needs its space turned into a "T" for Safari. Doing that
  // blindly broke the second — replace(' ', 'T') hits the FIRST space, so
  // "Sat Sep…" became "SatTSep…", which does not parse, and the cell showed a
  // raw 50-character date string.
  const isoish = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw);
  const d = new Date(isoish ? raw.replace(' ', 'T') : raw);
  if (Number.isNaN(d.getTime())) return { date: raw, relative: '' };

  const date =
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  let relative: string;
  if (mins < 1) relative = 'just now';
  else if (mins < 60) relative = `${mins}m ago`;
  else if (mins < 1440) relative = `${Math.round(mins / 60)}h ago`;
  else relative = `${Math.round(mins / 1440)}d ago`;

  return { date, relative };
}

export function DispatchTable({ initial }: { initial: DispatchListResponse }) {
  const [data, setData] = useState<DispatchListResponse>(initial);
  const [status, setStatus] = useState<DispatchStatus>('outstanding');
  const [query, setQuery] = useState('');
  const [batch, setBatch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial.error ?? null);

  // Debounced, so a 12-character tracking number sends one request rather than
  // twelve — each one joins two sheets server-side.
  const trimmed = query.trim();
  const [activeQuery, setActiveQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setActiveQuery(trimmed), 350);
    return () => clearTimeout(id);
  }, [trimmed]);

  // Any filter change restarts paging: page 4 of the previous result set may
  // not exist in the new one.
  useEffect(() => {
    setPage(0);
  }, [status, activeQuery, batch]);

  // Skips the fetch on first render, since the server already provided page 1.
  const mounted = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        offset: String(page * PAGE_SIZE),
        limit: String(PAGE_SIZE),
        status
      });
      if (activeQuery) params.set('q', activeQuery);
      if (batch) params.set('batch', batch);

      const res = await fetch(`/api/dispatch?${params}`);
      const json: DispatchListResponse = await res.json();
      setData(json);
      if (json.error) setError(json.error);
    } catch {
      setError('Could not reach the dashboard server. Nothing was changed — reload and try again.');
    } finally {
      setLoading(false);
    }
  }, [page, status, activeQuery, batch]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    load();
  }, [load]);

  const rows = data.rows ?? [];
  const pageCount = Math.max(1, Math.ceil((data.matchCount || 0) / PAGE_SIZE));

  // Batch options come from the rows on screen. A complete list would need its
  // own endpoint; this covers the real case — reviewing a run you can see.
  const batchOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.batch).filter(Boolean))).sort(),
    [rows]
  );

  // Unresolved parcels float to the top of the page: they left the building
  // with nothing knowing which order they belong to, and need a person.
  const ordered = useMemo(
    () => [...rows].sort((a, b) => Number(b.unresolved) - Number(a.unresolved)),
    [rows]
  );

  const hasFilters = Boolean(activeQuery || batch || status !== 'outstanding');
  const btn =
    'rounded-lg border border-border bg-panel px-2.5 py-1.5 text-xs text-ink shadow-sm transition-colors hover:border-border-strong hover:bg-raised disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-panel';

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-panel px-3 py-3 shadow-card">
        <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
          <span className="text-[11px] uppercase tracking-wide text-faint">Search</span>
          <input
            id="dispatch-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tracking ID, order, customer, items, or batch…"
            className="w-full min-w-[200px] rounded-lg border border-border bg-panel px-3 py-1.5 text-sm text-ink shadow-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Status</span>
          <select
            id="dispatch-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as DispatchStatus)}
            className="w-40 rounded-lg border border-border bg-panel px-2 py-1.5 text-xs text-ink shadow-sm focus:border-accent focus:outline-none"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-faint">Batch</span>
          <select
            id="dispatch-batch"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            className="w-36 rounded-lg border border-border bg-panel px-2 py-1.5 text-xs text-ink shadow-sm focus:border-accent focus:outline-none"
          >
            <option value="">All batches</option>
            {batchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setBatch('');
              setStatus('outstanding');
            }}
            className="rounded-lg border border-border bg-panel px-2.5 py-1.5 text-xs text-muted shadow-sm transition-colors hover:border-border-strong hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-amber/30 bg-amber/[0.04] px-3 py-2 text-xs text-amber">{error}</p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-panel shadow-card">
        <table className="w-full min-w-[840px] table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[13%]" />{/* Dispatched */}
            <col className="w-[16%]" />{/* Tracking ID */}
            <col className="w-[14%]" />{/* Order */}
            <col className="w-[15%]" />{/* Customer */}
            <col className="w-[11%]" />{/* Batch */}
            <col className="w-[12%]" />{/* State */}
            <col />{/* Items */}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-raised text-[11px] uppercase tracking-wide text-faint">
              <th className="px-3 py-2.5 font-medium">Dispatched</th>
              <th className="px-3 py-2.5 font-medium">Tracking ID</th>
              <th className="px-3 py-2.5 font-medium">Order</th>
              <th className="px-3 py-2.5 font-medium">Customer</th>
              <th className="px-3 py-2.5 font-medium">Batch</th>
              <th className="px-3 py-2.5 font-medium">State</th>
              <th className="px-3 py-2.5 font-medium">Items</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              rows.length === 0 &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-border last:border-0">
                  {Array.from({ length: 7 }).map((__, c) => (
                    <td key={c} className="px-3 py-2.5">
                      <div
                        className="h-3 animate-pulse rounded bg-raised"
                        style={{ width: `${[70, 80, 60, 65, 45, 50, 85][c]}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))}

            {ordered.map((r) => {
              const stamp = formatStamp(r.dispatchedAt);
              return (
                <tr
                  key={`${r.trackingId}-${r.dispatchedAt}`}
                  className={`border-b border-border transition-colors last:border-0 ${
                    r.unresolved ? 'bg-amber/[0.05] hover:bg-raised' : 'hover:bg-raised'
                  }`}
                >
                  <td className="tabular px-3 py-2.5 text-xs">
                    <span className="flex flex-col leading-tight">
                      <span className="whitespace-nowrap text-muted">{stamp.date}</span>
                      <span className="text-[10px] text-faint">{stamp.relative}</span>
                    </span>
                  </td>

                  <td className="tabular px-3 py-2.5 font-medium text-ink">
                    <CopyValue value={r.trackingId} title="Tracking ID" />
                  </td>

                  <td className="px-3 py-2.5 text-ink">
                    {r.unresolved ? (
                      <span
                        className="inline-flex items-center gap-1 rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[11px] text-amber"
                        title="This parcel left the warehouse but no order could be matched to it — someone needs to identify it."
                      >
                        unresolved
                      </span>
                    ) : r.orderName ? (
                      <span className="flex flex-col leading-tight">
                        <CopyValue value={r.orderName} title="Order" className="text-ink" />
                        {/* Only worth showing when it differs — on a single-parcel
                            order the base order is the order. */}
                        {r.baseOrder && r.baseOrder !== r.orderName && (
                          <span className="truncate text-[10px] text-faint">{r.baseOrder}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-muted">
                    {r.customerName ? (
                      <CopyValue value={r.customerName} title="Customer" />
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>

                  <td className="tabular px-3 py-2.5 text-xs">
                    {r.batch ? (
                      <button
                        type="button"
                        onClick={() => setBatch(r.batch)}
                        title={`Show only batch ${r.batch}`}
                        className="truncate text-muted underline-offset-2 hover:text-accent hover:underline"
                      >
                        {r.batch}
                      </button>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5">
                    {r.delivered ? (
                      <span className="inline-block whitespace-nowrap rounded-full border border-teal/30 bg-teal/10 px-2 py-0.5 text-[11px] font-medium text-teal">
                        Delivered
                      </span>
                    ) : (
                      <span
                        className="inline-block whitespace-nowrap rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[11px] font-medium text-violet"
                        title="Scanned out of the warehouse, with no delivery recorded yet"
                      >
                        In flight
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2.5 align-top text-muted">
                    <ItemsCell items={r.items} expanded={false} onToggle={() => {}} />
                  </td>
                </tr>
              );
            })}

            {!loading && ordered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center">
                  {data.summary.dispatched === 0 && !hasFilters ? (
                    // First run: the Dispatch tab is created by the Android app
                    // on its first door scan. Nothing is wrong yet.
                    <>
                      <div className="text-sm text-ink">No parcels scanned out yet</div>
                      <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                        Parcels appear here as staff scan them at the door on the way to the van. Until the first
                        scan, this page has nothing to show — that is expected, not an error.
                      </p>
                    </>
                  ) : hasFilters ? (
                    <>
                      <div className="text-sm text-ink">No parcels match these filters.</div>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery('');
                          setBatch('');
                          setStatus('outstanding');
                        }}
                        className="mt-2 text-xs text-accent hover:underline"
                      >
                        Clear all filters
                      </button>
                    </>
                  ) : (
                    <div className="text-sm text-teal">
                      Nothing outstanding — every dispatched parcel has been delivered.
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setPage(0)} disabled={loading || page === 0} className={btn} title="First page">
          «
        </button>
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={loading || page === 0} className={btn}>
          ← Prev
        </button>
        <button onClick={() => setPage((p) => p + 1)} disabled={loading || !data.hasMore} className={btn}>
          Next →
        </button>

        <span className="tabular ml-1 flex items-center gap-1.5 text-xs text-muted">
          <span className="text-faint">Page</span>
          <input
            id="dispatch-page"
            type="number"
            min={1}
            max={pageCount}
            value={page + 1}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 1) setPage(Math.min(pageCount - 1, v - 1));
            }}
            className="w-14 rounded-lg border border-border bg-panel px-1.5 py-1 text-center text-xs text-ink shadow-sm focus:border-accent focus:outline-none"
            aria-label="Go to page"
          />
          <span className="text-faint">of {pageCount}</span>
        </span>

        <span className="tabular text-xs text-faint">
          {data.matchCount.toLocaleString()} {data.searched || hasFilters ? 'matching' : ''} parcel
          {data.matchCount === 1 ? '' : 's'}
        </span>
        {loading && <span className="text-xs text-faint">loading…</span>}
      </div>

      <p className="mt-3 text-[11px] text-faint">
        Looking for proof photos or delivery status?{' '}
        <Link href="/deliveries" className="text-accent hover:underline">
          Open Deliveries
        </Link>
        .
      </p>
    </div>
  );
}
