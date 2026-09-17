'use client';

import { mergeItems, parseItems, shortTitle } from '@/lib/media';

// The Items column used to print the raw pipe-joined string and truncate it,
// which meant every row showed the same opening words of one very long title
// and told you nothing. Live data: median 212 characters per cell, max 840,
// but 71% of deliveries hold only one or two distinct products.
//
// So: show each product on its own line with a quantity, shortened to the part
// that identifies it, and let the row expand for the full text.

export function ItemsCell({
  items,
  expanded,
  onToggle
}: {
  items: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!items) return <span className="text-faint">—</span>;

  const parsed = mergeItems(parseItems(items));
  if (parsed.length === 0) return <span className="text-faint">—</span>;

  if (expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="block w-full cursor-zoom-out text-left"
        title="Collapse"
      >
        <ul className="flex flex-col gap-1">
          {parsed.map((item, i) => (
            <li key={i} className="flex gap-1.5 leading-snug">
              <span className="tabular shrink-0 text-faint">{item.qty}×</span>
              <span className="text-muted">{item.title}</span>
            </li>
          ))}
        </ul>
      </button>
    );
  }

  // Collapsed: the first product names the delivery, and a count carries the
  // rest. Showing two truncated lines instead reads as noise at row height.
  const first = parsed[0];
  const more = parsed.length - 1;

  return (
    <button
      type="button"
      onClick={onToggle}
      title={items}
      className="flex w-full items-baseline gap-1.5 text-left leading-snug hover:text-ink"
    >
      <span className="tabular shrink-0 text-faint">{first.qty}×</span>
      <span className="min-w-0 flex-1 truncate text-muted">{shortTitle(first.title, 48)}</span>
      {more > 0 && (
        <span
          className="tabular shrink-0 rounded border border-border bg-raised px-1 text-[10px] text-faint"
          title={`${more} more product${more === 1 ? '' : 's'} — click to expand`}
        >
          +{more}
        </span>
      )}
    </button>
  );
}
