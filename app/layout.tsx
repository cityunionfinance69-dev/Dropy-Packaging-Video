import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { SidebarNav } from '@/components/SidebarNav';
import { SignOutButton } from '@/components/SignOutButton';
import './globals.css';

// next/font downloads and self-hosts these at build time — no external request
// to Google Fonts from the visitor's browser, which is both faster and avoids
// leaking visitor IPs to Google. The CSS variables feed tailwind.config.ts.
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans'
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono'
});

export const metadata: Metadata = {
  title: 'Droppy — Ops Dashboard',
  description: 'Delivery verification, Drive storage, and Shopify sync health at a glance.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      {/* Phones: a plain row across the top, no hover to rely on.
          md and up: a 56px icon rail that widens to 224px on hover.

          The rail is a normal in-flow column, so expanding it PUSHES the page
          across rather than covering it. An overlay was tried first and read
          as the nav sitting on top of the data; the table reflow that pushing
          costs is the lesser problem, and the percentage column widths absorb
          it smoothly. */}
      <body className="flex min-h-screen flex-col md:flex-row">
        <aside className="group/nav z-30 shrink-0 border-b border-border bg-panel md:w-14 md:border-b-0 md:border-r md:transition-[width] md:duration-150 md:hover:w-56">
          <div
            className="flex items-center gap-2 px-4 py-3 md:sticky md:top-0 md:h-screen md:flex-col md:items-stretch md:overflow-hidden md:px-2 md:py-4 md:transition-[padding] md:duration-150 md:group-hover/nav:px-3"
          >
            <div className="flex items-center gap-2 md:mb-6 md:px-1">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white">
                D
              </div>
              {/* Hidden rather than removed while collapsed, so the expanded
                  panel needs no second copy of the wordmark. */}
              <div className="min-w-0 overflow-hidden transition-[width,opacity] duration-150 md:w-0 md:opacity-0 md:group-hover/nav:w-auto md:group-hover/nav:opacity-100">
                <div className="truncate text-sm font-semibold leading-tight tracking-tight text-ink">Droppy</div>
                <div className="truncate text-xs leading-tight text-muted">Ops Dashboard</div>
              </div>
            </div>
            <SidebarNav />
            {/* Pushed to the foot of the rail so it never sits among the
                navigation items — signing out is not somewhere you go. */}
            <div className="md:mt-auto">
              <SignOutButton />
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
      </body>
    </html>
  );
}
