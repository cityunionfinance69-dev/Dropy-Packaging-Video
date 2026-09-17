'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Server components (like HealthPage) can't refetch on a click — this is the
// smallest possible client island to make "try refreshing" an actual button
// instead of a browser-reload instruction, using router.refresh() to re-run
// the server component's fetchStats() call without a full page reload.
export function RetryButton() {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setRetrying(true);
        router.refresh();
        setTimeout(() => setRetrying(false), 1500);
      }}
      disabled={retrying}
      className="mt-3 rounded-lg border border-border bg-panel px-3 py-1.5 text-xs text-ink shadow-sm transition-colors hover:border-border-strong hover:bg-raised disabled:opacity-50"
    >
      {retrying ? 'Retrying…' : 'Retry'}
    </button>
  );
}
