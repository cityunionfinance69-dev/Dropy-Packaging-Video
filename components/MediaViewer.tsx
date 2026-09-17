'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeliveryRow } from '@/lib/appsScript';
import {
  addedAt,
  driveThumb,
  formatFullDateTime,
  formatRelative,
  mediaItems,
  purgedAt,
  statusAt,
  type MediaItem
} from '@/lib/media';

// Full-size media gallery for one delivery: one large stage, a thumbnail rail
// to switch between items, and the delivery's real timeline underneath.
//
// Everything image-shaped goes through our own /api/thumbnail proxy (see
// lib/media.ts) rather than hitting Drive from the <img> directly, which
// Chrome's ORB blocks.

function PhotoStage({ item }: { item: MediaItem }) {
  // Keyed remount per item so a slow-loading photo never shows the *previous*
  // photo's loaded state while the new one is still in flight.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!item.driveId) return null;

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {!loaded && !failed && (
        <div className="absolute inset-0 animate-pulse rounded bg-raised" aria-hidden />
      )}
      {failed ? (
        <div className="px-6 text-center">
          <p className="text-sm text-muted">This image couldn&apos;t be loaded from Drive.</p>
          <a
            href={`https://drive.google.com/file/d/${item.driveId}/view`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-accent hover:underline"
          >
            Open in Drive →
          </a>
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={driveThumb(item.driveId, 1400)}
          alt={item.label}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`max-h-full max-w-full rounded object-contain transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}

function VideoStage({ item }: { item: MediaItem }) {
  // Drive's /preview endpoint (distinct from /view and from the thumbnail
  // endpoint) is built for exactly this — cross-origin iframe embedding of a
  // shared file, with its own player chrome — so the Drive-hosted variant plays
  // inline instead of just linking out.
  const src = item.youtubeUrl ?? (item.driveId ? `https://drive.google.com/file/d/${item.driveId}/preview` : null);
  if (!src) return null;

  return (
    <div className="aspect-video max-h-full w-full overflow-hidden rounded border border-border bg-black">
      <iframe
        src={src}
        title={item.label}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

/** One row of the timeline: label, absolute time, relative time. */
function TimelineEntry({
  label,
  date,
  raw,
  tone = 'neutral'
}: {
  label: string;
  date: Date | null;
  /** Shown when the stamp exists but didn't parse — better than rendering "—". */
  raw?: string;
  tone?: 'neutral' | 'warn';
}) {
  const hasValue = date !== null || Boolean(raw);
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd
        className={`tabular mt-0.5 text-xs ${
          !hasValue ? 'text-faint' : tone === 'warn' ? 'text-amber' : 'text-ink'
        }`}
      >
        {date ? formatFullDateTime(date) : raw || '—'}
        {date && <span className="ml-1.5 text-faint">{formatRelative(date)}</span>}
      </dd>
    </div>
  );
}

export function MediaViewer({ row, onClose }: { row: DeliveryRow; onClose: () => void }) {
  const items = useMemo(() => mediaItems(row), [row]);
  const [index, setIndex] = useState(0);

  const count = items.length;
  const go = useCallback(
    (delta: number) => setIndex((i) => (count === 0 ? 0 : (i + delta + count) % count)),
    [count]
  );

  const panelRef = useRef<HTMLDivElement>(null);

  // Focus management. Without this, a keyboard user opening the viewer keeps
  // tabbing through the table *behind* the overlay — the dialog looks modal but
  // doesn't behave modally. Focus moves in on open, is trapped while open, and
  // returns to whatever opened it on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowRight') {
        go(1);
        return;
      }
      if (e.key === 'ArrowLeft') {
        go(-1);
        return;
      }
      if (e.key !== 'Tab') return;

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while the overlay is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose, go]);

  const current = items[index];
  const purged = purgedAt(row);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Media for ${row.trackingId}`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex max-h-[94vh] w-full max-w-5xl animate-scale-in flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-modal focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — identity of the delivery, not of the media item. */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="tabular truncate text-sm font-semibold text-ink">{row.trackingId}</h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              {row.orderName || 'no order name'}
              {row.customerName && <span className="text-faint"> · {row.customerName}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {row.folderId && !row.filesDeleted && (
              <a
                href={`https://drive.google.com/drive/folders/${row.folderId}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                Drive folder →
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded px-1.5 py-0.5 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Stage */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-raised p-3 [max-height:58vh]">
          {count === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-muted">
                {row.filesDeleted ? 'Media was archived and purged.' : 'No media on this delivery.'}
              </p>
              {purged && (
                <p className="tabular mt-1 text-xs text-faint">
                  Purged {formatFullDateTime(purged)} · {formatRelative(purged)}
                </p>
              )}
              {row.filesDeleted && !purged && (
                <p className="tabular mt-1 text-xs text-faint">Purged · {row.filesDeleted}</p>
              )}
            </div>
          ) : current.kind === 'video' ? (
            <VideoStage key={current.id} item={current} />
          ) : (
            <PhotoStage key={current.id} item={current} />
          )}

          {/* Prev/next only earn their space when there's more than one item. */}
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-border bg-panel px-2.5 py-1.5 text-sm text-ink shadow-card transition-colors hover:border-border-strong"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-border bg-panel px-2.5 py-1.5 text-sm text-ink shadow-card transition-colors hover:border-border-strong"
              >
                ›
              </button>
            </>
          )}
        </div>

        {/* Thumbnail rail */}
        {count > 1 && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
            {items.map((item, i) => {
              const active = i === index;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={active ? 'true' : undefined}
                  className={`group relative h-12 w-12 shrink-0 overflow-hidden rounded border transition-colors ${
                    active ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-strong'
                  }`}
                  title={item.label}
                >
                  {item.driveId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={driveThumb(item.driveId, 120)}
                      alt={item.label}
                      loading="lazy"
                      decoding="async"
                      className={`h-full w-full object-cover transition-opacity ${active ? '' : 'opacity-70 group-hover:opacity-100'}`}
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-raised text-violet">▶</span>
                  )}
                  {item.kind === 'video' && item.driveId && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
                      ▶
                    </span>
                  )}
                </button>
              );
            })}
            <span className="ml-1 text-xs text-faint">
              {current?.label} · {index + 1}/{count}
            </span>
          </div>
        )}

        {/* Timeline — the three real timestamps this delivery actually has.
            Nothing records a download event anywhere in the sheet or Apps
            Script, so there is deliberately no "downloaded" row here. */}
        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 border-t border-border px-5 py-3 sm:grid-cols-4">
          <TimelineEntry label="Packed / added" date={addedAt(row)} />
          <TimelineEntry label={row.deliveryStatus || 'Status'} date={statusAt(row)} />
          <TimelineEntry
            label="Media purged"
            date={purged}
            raw={row.filesDeleted || undefined}
            tone={row.filesDeleted ? 'warn' : 'neutral'}
          />
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-faint">Drive account</dt>
            <dd className="mt-0.5 truncate text-xs text-ink" title={row.driveAccount}>
              {row.driveAccount || '—'}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
