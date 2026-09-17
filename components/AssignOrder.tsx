'use client';

import { useState } from 'react';
import { orderSegments } from '@/lib/media';

// Inline "type the order number" control for a row Shopify never matched.
//
// Two ways to save, and the difference matters:
//
//   VERIFIED (default)  asks Shopify for the order and copies the real
//                       customer, items and price into the sheet. A wrong
//                       number is rejected rather than stored.
//
//   UNVERIFIED          writes ONLY the order number, no lookup. Offered just
//                       when Shopify itself is unreachable, so the knowledge
//                       "this parcel is order 1642" can still be captured
//                       while the token is dead. Customer/items/price stay
//                       blank on purpose — a row that looks complete but holds
//                       unverified data is worse than an obviously partial one.
//                       repairDeliveryRows() fills the rest in later.

type Props = {
  trackingId: string;
  /** Called after a successful assign so the table can refresh that row. */
  onAssigned: (trackingId: string, orderName: string) => void;
};

export function AssignOrder({ trackingId, onAssigned }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; unverified: boolean } | null>(null);

  // Set when the failure was Shopify being unreachable — the only case where
  // saving without a lookup is the right offer.
  const [shopifyDown, setShopifyDown] = useState(false);

  async function submit(opts: { force?: boolean; unverified?: boolean } = {}) {
    const orderName = value.trim();
    if (!orderName || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/assign-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingId, orderName, ...opts })
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Could not assign that order.');
        setShopifyDown(String(data.error || '').includes('Shopify rejected the request'));
        return;
      }
      setDone({ name: data.orderName, unverified: data.unverified === true });
      onAssigned(trackingId, data.orderName);
    } catch (err) {
      // Distinguish "the request never left / never landed" from a real
      // server answer. The generic "Network error" hid the most common cause:
      // a stale page whose dev server has since been restarted, so the fetch
      // has nowhere to go. Saying so saves hunting the wrong problem.
      setError(
        `Could not reach the dashboard server (${err instanceof Error ? err.message : 'request failed'}). ` +
          'Nothing was saved. If the page has been open a while, reload it and try again.'
      );
      setShopifyDown(false);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return done.unverified ? (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[11px] text-amber"
        title="Saved without a Shopify lookup — customer, items and price are still blank. Run repairDeliveryRows() once the token works."
      >
        {done.name} <span className="text-[10px]">unverified</span>
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-teal" title="Saved to the sheet">
        ✓ {done.name}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="No Shopify order matched this tracking ID — assign one"
        className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-red/30 bg-red/10 px-1.5 py-0.5 text-[11px] text-red transition-colors hover:border-red/60 hover:bg-red/20"
      >
        unmatched
        <span className="text-[13px] leading-none text-red/70">+</span>
      </button>
    );
  }

  // Shown live under the input: what the typed value resolves to, so the
  // parent-order/parcel split is visible before anything is saved.
  const segs = orderSegments(value);
  const preview =
    segs.length > 1
      ? `order ${segs[0]} · parcel ${segs.slice(1).join('-')}`
      : segs.length === 1
        ? `order ${segs[0]}`
        : null;

  return (
    <span className="flex w-full min-w-0 flex-col gap-1 align-top" onClick={(e) => e.stopPropagation()}>
      <span className="flex min-w-0 items-center gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') {
              setOpen(false);
              setError(null);
            }
          }}
          placeholder="1642-1-1"
          aria-label={`Order number for ${trackingId}`}
          disabled={busy}
          className="tabular w-full min-w-0 rounded-lg border border-border bg-panel px-1.5 py-1 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => submit()}
          disabled={busy || !value.trim()}
          className="rounded-lg border border-accent/30 bg-accent/10 px-1.5 py-1 text-[11px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="px-1 text-[11px] text-faint hover:text-ink"
          aria-label="Cancel"
        >
          ✕
        </button>
      </span>

      {preview && !error && <span className="text-[10px] text-faint">{preview}</span>}

      {/* Inline, not an overlay: the table sits in an overflow-x-auto
          container, which clips absolutely-positioned children — a popup here
          would be cut off at the row edge. Wrapping inside the cell is the one
          layout that cannot be clipped. */}
      {error && (
        <span className="block w-full rounded-lg border border-red/30 bg-red/[0.04] p-1.5 text-[10px] leading-snug text-red">
          {error}
          {error.includes('force=true') && (
            <button type="button" onClick={() => submit({ force: true })} className="ml-1 underline hover:text-ink">
              replace anyway
            </button>
          )}
          {/* Offered only when Shopify is the thing that's broken. Saving
              without a lookup when the order number is simply wrong would
              record a mistake as fact. */}
          {shopifyDown && (
            <span className="mt-1 block text-amber">
              <button type="button" onClick={() => submit({ unverified: true })} className="underline hover:text-ink">
                Save the number anyway
              </button>{' '}
              — records it only; customer, items and price stay blank until the token is fixed.
            </span>
          )}
        </span>
      )}
    </span>
  );
}
