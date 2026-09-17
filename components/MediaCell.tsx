'use client';

import { useState } from 'react';
import type { DeliveryRow } from '@/lib/appsScript';
import { driveThumb, formatFullDateTime, mediaItems, mediaState, purgedAt, type MediaItem } from '@/lib/media';

// The Media column's job at a glance: does this delivery have its proof media,
// what kind, and can I open it. Three states, each visually distinct so a
// column of rows is scannable without reading any text:
//
//   present  thumbnails — the delivery is fine, here's the evidence
//   purged   a quiet dashed placeholder — expected end state, not a problem
//   none     an amber-ringed warning — media is MISSING and someone should care
//
// Purged and none used to both read as grey text, which buried the one case
// that actually needs attention.

function Thumb({ item, onClick }: { item: MediaItem; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  const isVideo = item.kind === 'video';

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${item.label} — click to open`}
      className="group relative h-9 w-9 shrink-0 overflow-hidden rounded border border-border bg-raised transition-colors hover:border-accent focus-visible:border-accent"
    >
      {item.driveId && !failed ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={driveThumb(item.driveId, 120)}
            alt={item.label}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
          {isVideo && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[10px] text-white">
              ▶
            </span>
          )}
        </>
      ) : (
        // No Drive id (YouTube-only video) or a thumbnail that failed to load —
        // still show the slot, typed, rather than a broken image.
        <span
          className={`flex h-full w-full items-center justify-center text-[10px] ${
            isVideo ? 'text-violet' : 'text-faint'
          }`}
        >
          {isVideo ? '▶' : '▤'}
        </span>
      )}
    </button>
  );
}

export function MediaCell({ row, onOpen }: { row: DeliveryRow; onOpen: (row: DeliveryRow) => void }) {
  const state = mediaState(row);

  if (state === 'purged') {
    const purged = purgedAt(row);
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded border border-dashed border-border px-2 py-1 text-[11px] text-faint"
        title={purged ? `Media purged ${formatFullDateTime(purged)}` : `Media purged · ${row.filesDeleted}`}
      >
        <span aria-hidden>⌀</span>
        purged
      </span>
    );
  }

  if (state === 'none') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded border border-amber/40 bg-amber/10 px-2 py-1 text-[11px] text-amber"
        title="No photos or video were ever recorded for this delivery"
      >
        <span aria-hidden>⚠</span>
        no media
      </span>
    );
  }

  const items = mediaItems(row);
  // Two tiles, not three: the strip is the widest fixed cost in the row and
  // only needs to answer "is there media, and how much" — the +N badge and
  // the viewer carry the rest.
  const shown = items.slice(0, 2);
  const extra = items.length - shown.length;

  return (
    <div className="flex items-center gap-1.5">
      {shown.map((item) => (
        <Thumb key={item.id} item={item} onClick={() => onOpen(row)} />
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={() => onOpen(row)}
          className="h-9 shrink-0 rounded border border-border bg-raised px-1.5 text-[11px] text-muted hover:border-accent hover:text-ink"
          title={`${extra} more item${extra === 1 ? '' : 's'}`}
        >
          +{extra}
        </button>
      )}
      {row.folderId && (
        <a
          href={`https://drive.google.com/drive/folders/${row.folderId}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open this tracking ID's Drive folder"
          className="shrink-0 px-0.5 text-xs text-faint transition-colors hover:text-accent"
          aria-label="Open Drive folder"
        >
          ↗
        </a>
      )}
    </div>
  );
}
