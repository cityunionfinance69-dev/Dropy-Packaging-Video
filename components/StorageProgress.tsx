'use client';

import { useEffect, useRef, useState } from 'react';

// "6 of 10 accounts loaded" while the fleet streams in.
//
// The cards already arrive one at a time — each has its own Suspense boundary —
// but nothing said so, and a page with four real cards and six pulsing
// skeletons reads as broken rather than as working-and-not-finished. Measured,
// the accounts answer anywhere between 2s and 60s, so the wait is real and the
// only honest fix is to narrate it.
//
// Counting happens in the browser rather than on the server because the server
// cannot report progress on a render it has not finished: the whole point is to
// say something WHILE the streaming is still going.
export function StorageProgress({ total }: { total: number }) {
  const [loaded, setLoaded] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (total === 0) return;

    // A card is "loaded" once its real content replaces the skeleton. Both
    // carry a data attribute, so counting is a query rather than a guess about
    // markup.
    const count = () => {
      const done = document.querySelectorAll('[data-storage-card="loaded"]').length;
      setLoaded(done);
      return done;
    };

    if (count() >= total) return;

    // MutationObserver rather than polling: React replaces each boundary as its
    // data lands, and that is exactly the event worth reacting to.
    const observer = new MutationObserver(() => {
      if (count() >= total) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const tick = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);

    return () => {
      observer.disconnect();
      clearInterval(tick);
    };
  }, [total]);

  if (total === 0 || loaded >= total) return null;

  const pct = Math.round((loaded / total) * 100);

  return (
    <div className="mt-3 rounded-xl border border-border bg-panel px-4 py-2.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="tabular text-xs text-muted">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
          Loading storage accounts — <span className="font-medium text-ink">{loaded}</span> of {total} ready
        </span>
        <span className="tabular text-[11px] text-faint">
          {pct}%{elapsed > 3 ? ` · ${elapsed}s` : ''}
        </span>
      </div>

      <div
        className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-valuenow={loaded}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Storage accounts loaded"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>

      {/* Only once the wait is long enough to need explaining. Google's quota
          endpoint genuinely takes up to a minute for some accounts, and saying
          so is better than leaving someone to conclude the page is stuck. */}
      {elapsed > 8 && (
        <p className="mt-1.5 text-[11px] text-faint">
          The remaining {total - loaded} account{total - loaded === 1 ? ' is' : 's are'} slow to answer. Everything
          already shown is live — the rest will fill in.
        </p>
      )}
    </div>
  );
}
