import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sign in — Droppy' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white">
            D
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight tracking-tight text-ink">Droppy</div>
            <div className="text-xs leading-tight text-muted">Ops Dashboard</div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-5 shadow-card">
          <h1 className="text-base font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-xs text-muted">
            This dashboard shows customer names, phone numbers and order values. Enter the team password to continue.
          </p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
