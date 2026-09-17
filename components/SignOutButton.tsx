'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  // The login page renders through the same root layout, and offering "sign
  // out" to someone who is not signed in is noise.
  if (pathname === '/login') return null;

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/login', { method: 'DELETE' });
    } finally {
      // Navigate regardless: the cookie is cleared server-side, so even if the
      // response never arrives the session is gone and the middleware will
      // bounce any further request back to /login.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      title="Sign out"
      className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 md:px-1.5 md:group-hover/nav:px-2"
    >
      <span className="grid w-7 shrink-0 place-items-center text-faint group-hover:text-ink">
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden>
          <path
            d="M12.5 13.5V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5h6A1.5 1.5 0 0 1 12.5 5v1.5M15 10H7.5m7.5 0-2.25-2.25M15 10l-2.25 2.25"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="truncate transition-[width,opacity] duration-150 md:w-0 md:overflow-hidden md:opacity-0 md:group-hover/nav:w-auto md:group-hover/nav:opacity-100">
        {busy ? 'Signing out…' : 'Sign out'}
      </span>
    </button>
  );
}
