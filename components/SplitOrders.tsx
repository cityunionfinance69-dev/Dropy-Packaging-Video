'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyValue } from '@/components/CopyValue';
import type { SplitListResponse, SplitOrderRow } from '@/lib/appsScript';

// Split orders, grouped by order.
//
// Grouping is the whole point: three rows each saying "1x Cable" tell you
// nothing, while one order showing cable / widget / charger across three
// tracking numbers is the entire story. A half-shipped order looks perfectly
// healthy parcel by parcel, which is exactly how a customer ends up missing an
// item with nothing in the record to contradict them.

const PAGE_SIZE = 25;

/** Partially shipped first — the actionable state, and the reason this exists. */
function rank(o: SplitOrderRow): number {
  // A verified shortfall outranks everything: units exist that no recorded box
  // accounts for.
  if ((o.unitsUnaccounted ?? 0) > 0) return 0;
  if (!o.allDispatched) return 1;
  if (!o.allDelivered) return 2;
  return 3;
}

function OrderCard({ order }: { order: SplitOrderRow }) {
  const [open, setOpen] = useState(false);
  const parcels = order.parcels ?? [];
  const unaccounted = order.unitsUnaccounted ?? 0;

  // Negative is a data error — more recorded than the order contains — not a
  // missing parcel, so it must not read as one.
  const dataError = unaccounted < 0;

  const state = !order.allDispatched
    ? { label: 'Partially dispatched', cls: 'border-red/30 bg-red/10 text-red' }
    : !order.allDelivered
      ? { label: 'In flight', cls: 'border-violet/30 bg-violet/10 text-violet' }
      : { label: 'Complete', cls: 'border-teal/30 bg-teal/10 text-teal' };

  return (
    <div
      className={`rounded-xl border bg-panel shadow-card ${
        unaccounted > 0 ? 'border-red/30' : 'border-border'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="tabular min-w-0 flex-1 text-sm font-medium text-ink">{order.baseOrder}</span>

        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${state.cls}`}>
          {state.label}
        </span>

        <span className="tabular shrink-0 text-xs text-muted">
          {order.parcelCount} parcel{order.parcelCount === 1 ? '' : 's'} · {order.units} unit
          {order.units === 1 ? '' : 's'}
        </span>

        {/* The number to lead with: units the recorded boxes cannot account
            for — the direct answer to "the customer says an item is missing". */}
        {unaccounted > 0 && (
          <span
            className="tabular shrink-0 rounded-full border border-red/40 bg-red/10 px-2 py-0.5 text-[11px] font-semibold text-red"
            title={`Shopify says this order contains ${order.unitsInOrder} units; recorded boxes account for ${
              (order.unitsInOrder ?? 0) - unaccounted
            }. Either a parcel has not shipped yet, or one shipped without being recorded.`}
          >
            {unaccounted} unit{unaccounted === 1 ? '' : 's'} unaccounted
          </span>
        )}

        {dataError && (
          <span
            className="shrink-0 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[11px] text-amber"
            title="More units recorded than the order contains — a data problem to investigate, not a missing parcel."
          >
            data mismatch
          </span>
        )}

        {order.shopifyStatus && (
          <span className="shrink-0 text-[11px] text-faint">{order.shopifyStatus}</span>
        )}

        <span aria-hidden className="shrink-0 text-xs text-faint">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          {parcels.length === 0 ? (
            <p className="text-xs text-muted">
              Parcel detail is only returned by the Shopify cross-check. Run it above to see which box holds what.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {parcels.map((p) => (
                <li key={p.trackingId} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="tabular text-xs font-medium text-ink">
                      <CopyValue value={p.trackingId} title="Tracking ID" />
                    </span>
                    {/* Dispatched and delivered are separate claims, and both
                        differ again from "we filmed it". */}
                    <span
                      className={`rounded-full border px-1.5 py-px text-[10px] ${
                        p.dispatched
                          ? 'border-teal/30 bg-teal/10 text-teal'
                          : 'border-amber/40 bg-amber/10 text-amber'
                      }`}
                    >
                      {p.dispatched ? 'dispatched' : 'not dispatched'}
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-px text-[10px] ${
                        p.delivered
                          ? 'border-teal/30 bg-teal/10 text-teal'
                          : 'border-border bg-raised text-muted'
                      }`}
                      title={p.carrierStatus ? `Carrier: ${p.carrierStatus}` : undefined}
                    >
                      {p.delivered ? 'delivered' : p.carrierStatus || 'not delivered'}
                    </span>
                    {p.hasRecord === false && (
                      <span
                        className="rounded-full border border-amber/40 bg-amber/10 px-1.5 py-px text-[10px] text-amber"
                        title="No proof media for this box"
                      >
                        no record
                      </span>
                    )}
                    {typeof p.units === 'number' && (
                      <span className="tabular text-[10px] text-faint">{p.units} units</span>
                    )}
                  </span>

                  {/* Only what is in THIS box — never the order contents. */}
                  {p.items && p.items.length > 0 && (
                    <ul className="flex flex-col gap-0.5 pl-1">
                      {p.items.map((it, i) => (
                        <li key={i} className="flex gap-1.5 text-xs leading-snug">
                          <span className="tabular shrink-0 text-faint">{it.qty ?? 1}×</span>
                          <span className="text-muted">{it.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function SplitOrders({ initial }: { initial: SplitListResponse }) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(initial.error ?? null);

  const trimmed = query.trim();
  const [activeQuery, setActiveQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setActiveQuery(trimmed), 350);
    return () => clearTimeout(id);
  }, [trimmed]);

  useEffect(() => {
    setPage(0);
  }, [activeQuery]);

  const mounted = useRef(false);

  const load = useCallback(
    async (verify = false) => {
      if (verify) setVerifying(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
        if (activeQuery) params.set('q', activeQuery);
        if (verify) params.set('verify', '1');

        const res = await fetch(`/api/split?${params}`);
        const json: SplitListResponse = await res.json();
        setData(json);
        if (json.error) setError(json.error);
      } catch {
        setError('Could not reach the dashboard server. Nothing was changed — reload and try again.');
      } finally {
        setLoading(false);
        setVerifying(false);
      }
    },
    [page, activeQuery]
  );

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    load();
  }, [load]);

  const rows = [...(data.rows ?? [])].sort((a, b) => rank(a) - rank(b));
  const pageCount = Math.max(1, Math.ceil((data.matchCount || 0) / PAGE_SIZE));
  const btn =
    'rounded-lg border border-border bg-panel px-2.5 py-1.5 text-xs text-ink shadow-sm transition-colors hover:border-border-strong hover:bg-raised disabled:opacity-40';

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-panel px-3 py-3 shadow-card">
        <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
          <span className="text-[11px] uppercase tracking-wide text-faint">Search</span>
          <input
            id="split-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Order, tracking ID, or product…"
            className="w-full min-w-[200px] rounded-lg border border-border bg-panel px-3 py-1.5 text-sm text-ink shadow-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>

        {/* Explicit action, never on page load: one Shopify call per order. */}
        <button
          type="button"
          onClick={() => load(true)}
          disabled={verifying || loading || rows.length === 0}
          title="Fetch each order on this page from Shopify and compare its real line quantities against the units we recorded"
          className="rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs text-accent shadow-sm transition-colors hover:bg-accent/20 disabled:opacity-40"
        >
          {verifying ? 'Checking…' : 'Check against Shopify'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-amber/30 bg-amber/[0.04] px-3 py-2 text-xs text-amber">{error}</p>
      )}

      {/* stoppedEarly is a normal outcome of a deadline, not a failure. */}
      {data.summary.verifyStoppedEarly && (
        <p className="mt-3 rounded-xl border border-border bg-panel px-3 py-2 text-xs text-muted">
          The check ran out of time after {data.summary.verified ?? 0} orders. Run it again to continue.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {rows.map((o) => (
          <OrderCard key={o.baseOrder} order={o} />
        ))}

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-border bg-panel px-4 py-12 text-center shadow-card">
            {activeQuery ? (
              <>
                <div className="text-sm text-ink">No split orders match that search.</div>
                <button type="button" onClick={() => setQuery('')} className="mt-2 text-xs text-accent hover:underline">
                  Clear search
                </button>
              </>
            ) : (
              <>
                <div className="text-sm text-ink">No split orders recorded yet</div>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted">
                  An order appears here once it ships as more than one parcel and the boxes are recorded at the
                  packing bench. Nothing to show is the expected state until then.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={loading || page === 0} className={btn}>
            ← Prev
          </button>
          <button onClick={() => setPage((p) => p + 1)} disabled={loading || !data.hasMore} className={btn}>
            Next →
          </button>
          <span className="tabular text-xs text-faint">
            Page {page + 1} of {pageCount} · {data.summary.splitOrders} split order
            {data.summary.splitOrders === 1 ? '' : 's'} · {data.summary.parcels} parcels · {data.summary.units} units
          </span>
          {loading && <span className="text-xs text-faint">loading…</span>}
        </div>
      )}
    </div>
  );
}
