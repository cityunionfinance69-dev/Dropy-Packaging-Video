import { fetchShopifyPing, fetchVelocityPing } from '@/lib/appsScript';

// Shopify and Velocity are the two upstream credentials this system depends on,
// and both fail silently: when a token dies, order matching, row repair, the
// daily status refresh and order assignment all stop, each surfacing as a
// different-looking symptom.
//
// It belongs on the dispatch view specifically because a dead token is the most
// likely cause of a sudden run of unresolved parcels — a parcel that physically
// left the building with nothing knowing its order. Connecting those two facts
// on one screen is the difference between a five-minute fix and an afternoon
// of debugging.
export async function UpstreamHealth() {
  // Independent probes, so a slow one cannot hide the other's answer.
  const [shopify, velocity] = await Promise.all([fetchShopifyPing(), fetchVelocityPing()]);

  const shopifyDown = shopify.success && shopify.shopifyOk === false;
  const velocityDown = velocity.success === false;
  // Non-empty only within 14 days of expiry — a scheduled outage, and the one
  // upstream failure here that can be fixed BEFORE it happens.
  const velocityWarning = Boolean(velocity.warning);

  if (!shopifyDown && !velocityDown && !velocityWarning) {
    // Healthy: one quiet line. A banner that is always present stops being read,
    // and the useful signal here is the exception, not the steady state.
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
          Shopify connected{shopify.shop ? ` · ${shopify.shop}` : ''}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden />
          Velocity token valid
          {typeof velocity.daysLeft === 'number' ? ` · ${velocity.daysLeft} days left` : ''}
        </span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {shopifyDown && (
        <div className="rounded-xl border border-red/30 bg-red/[0.05] px-3 py-2.5">
          <div className="text-xs font-semibold text-red">Shopify is not accepting the API token</div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            {shopify.reason} Order matching, row repair and status refresh are all stopped — this is the most likely
            reason parcels below show as <span className="font-medium">unresolved</span>.
          </p>
        </div>
      )}

      {velocityDown && (
        <div className="rounded-xl border border-red/30 bg-red/[0.05] px-3 py-2.5">
          <div className="text-xs font-semibold text-red">Velocity credential is not working</div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            {velocity.error ?? `HTTP ${velocity.httpCode ?? '?'}`} — split-parcel AWBs that Shopify has never seen
            cannot be resolved while this is down.
          </p>
        </div>
      )}

      {/* Expiry is a date in the future, so it is actionable in a way an
          already-dead token is not. Amber, not red: nothing is broken yet. */}
      {velocityWarning && !velocityDown && (
        <div className="rounded-xl border border-amber/30 bg-amber/[0.05] px-3 py-2.5">
          <div className="text-xs font-semibold text-amber">Velocity token expires soon</div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            {velocity.warning}
            {velocity.expires ? ` Expires ${velocity.expires}.` : ''} Renewing it now avoids an outage; after it
            lapses, split parcels stop resolving until someone notices.
          </p>
        </div>
      )}
    </div>
  );
}
