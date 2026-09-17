'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Incorrect password.');
        setPassword('');
        return;
      }

      // Only same-origin paths are honoured. Taking ?next verbatim would let a
      // crafted link bounce someone to another site straight after they log in,
      // which is the classic open-redirect phishing setup.
      const next = params.get('next');
      const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

      // refresh() re-runs the server components now that the cookie exists;
      // without it the app can render from a cache produced while signed out.
      router.replace(dest);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Password</span>
        <input
          id="dashboard-password"
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          disabled={busy}
          className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm text-ink shadow-sm placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
          placeholder="Team password"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg border border-red/30 bg-red/[0.04] px-2.5 py-2 text-xs text-red">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !password}
        className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
