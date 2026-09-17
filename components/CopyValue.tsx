'use client';

import { useEffect, useRef, useState } from 'react';

// Tracking IDs and order numbers exist to be pasted somewhere else — into
// Shopify, a courier's tracking page, a WhatsApp reply to a customer. Selecting
// them by hand out of a dense table is fiddly and easy to get wrong by a
// character, which for a 20-digit tracking number means a failed lookup with no
// obvious cause.
//
// Click to copy, with the value still readable as plain text rather than
// styled as a button: the whole row is already clickable for selection, so this
// has to stay visually quiet and only announce itself on hover.
export function CopyValue({
  value,
  className = '',
  title
}: {
  value: string;
  className?: string;
  /** Extra hover text; the copy hint is appended to it. */
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending reset if the row unmounts mid-flash — paginating away
  // from a row you just copied would otherwise set state on a dead component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy(e: React.MouseEvent) {
    // The row's own click handler selects the row; copying shouldn't also
    // change what's selected.
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be refused (permission, or a non-secure origin).
      // Fall back to a hidden selection so the copy still works instead of
      // silently doing nothing.
      const el = document.createElement('textarea');
      el.value = value;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(el);
      }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={title ? `${title} — click to copy` : `Copy ${value}`}
      aria-label={`Copy ${value}`}
      className={`group/copy inline-flex max-w-full items-center gap-1 text-left ${className}`}
    >
      <span className="truncate">{value}</span>
      {/* Reserves its own width so the text never shifts when the icon appears
          on hover. */}
      <span
        aria-hidden
        className={`shrink-0 transition-opacity ${
          copied ? 'text-teal opacity-100' : 'text-faint opacity-0 group-hover/copy:opacity-100'
        }`}
      >
        {copied ? (
          <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
            <path d="M3.5 8.5 6.5 11.5 12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.5 3.5H3.5a1 1 0 0 0-1 1v7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        )}
      </span>
    </button>
  );
}
