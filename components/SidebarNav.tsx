'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV: Array<{ href: string; label: string; icon: ReactNode }> = [
  {
    href: '/',
    label: 'Overview',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <path
          d="M3 10.5 10 4l7 6.5M5 9v6.5a1 1 0 0 0 1 1h2.5V13a1.5 1.5 0 0 1 3 0v3.5H14a1 1 0 0 0 1-1V9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  },
  {
    href: '/deliveries',
    label: 'Deliveries',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <rect x="3" y="6" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 9.5h14M7 6V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  },
  {
    href: '/health',
    label: 'Health',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <path
          d="M3 10.5h3.2l1.6-4 2.4 8 1.6-4H17"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-row gap-1 md:flex-col">
      {NAV.map((item) => {
        // "/" only matches exactly; every other route also matches its own
        // sub-paths, so e.g. /deliveries stays highlighted if this app ever
        // grows a /deliveries/[id] detail route.
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            // title carries the name while the rail is collapsed — the label
            // itself is faded out there, so hover text is the only way to read
            // a nav item without expanding.
            title={item.label}
            className={`group flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors md:px-1.5 md:group-hover/nav:px-2 ${
              active ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            <span className={`grid w-7 shrink-0 place-items-center ${active ? 'text-accent' : 'text-faint group-hover:text-ink'}`}>
              {item.icon}
            </span>
            {/* Fades and collapses with the rail rather than unmounting, so the
                row keeps one DOM node and the icon never jumps. */}
            {/* Collapsed, the label must take NO width — at opacity-0 alone it
                still occupied its track and `truncate` clipped it to "O." /
                "D." inside the 56px rail. w-0 + overflow-hidden removes it
                from layout, and it reappears on hover. */}
            <span className="truncate transition-[width,opacity] duration-150 md:w-0 md:overflow-hidden md:opacity-0 md:group-hover/nav:w-auto md:group-hover/nav:opacity-100">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
