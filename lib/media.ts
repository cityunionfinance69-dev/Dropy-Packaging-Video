// Everything about "what media does this delivery have, and when did things
// happen to it" lives here, so the table cell and the viewer can't drift apart
// in how they classify or label the same row.
//
// Deliberately NOT in appsScript.ts: that file's job is the transport boundary
// (it knows Apps Script's wire format and nothing else). This is presentation
// logic derived from those fields.
import type { DeliveryRow } from '@/lib/appsScript';

export type MediaKind = 'photo' | 'video';

export type MediaItem = {
  /** Stable key + the id the Drive proxy needs. YouTube items have no Drive id. */
  id: string;
  kind: MediaKind;
  /** Short human label: "Front", "Back", "Label", "Video". */
  label: string;
  /** Drive file id for proxying thumbnails/full images. Null for YouTube. */
  driveId: string | null;
  /** Set only for the YouTube-hosted video variant. */
  youtubeUrl?: string;
};

// Both drive.google.com/thumbnail and the lh3.googleusercontent.com URL it
// redirects to get blocked by Chrome's Opaque Response Blocking (ORB) when
// loaded directly from an <img> tag on a real page — confirmed against a live
// browser, not just curl (curl doesn't enforce ORB, so it looked fine there).
// Routing through our own API proxy sidesteps ORB entirely: it's a same-origin
// request as far as the browser is concerned, and the actual Drive fetch
// happens server-side where ORB doesn't apply.
export function driveThumb(fileId: string, size = 160): string {
  return `/api/thumbnail?id=${fileId}&sz=w${size}`;
}

export function youtubeEmbedUrl(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

/**
 * The delivery's media as an ordered list. Front/Back/Label first (that's the
 * order they're shot in), video last.
 *
 * Returns [] for a purged row even when the id columns still hold values — the
 * ids outlive the files, so rendering them would produce broken images.
 */
export function mediaItems(row: DeliveryRow): MediaItem[] {
  if (row.filesDeleted) return [];

  const items: MediaItem[] = [];
  const photos: Array<[string, string]> = [
    ['Front', row.frontPhotoId],
    ['Back', row.backPhotoId],
    ['Label', row.labelPhotoId]
  ];
  for (const [label, id] of photos) {
    if (id) items.push({ id, kind: 'photo', label, driveId: id });
  }

  // A row can carry both a YouTube URL and the original Drive file. They're the
  // same footage, so show one: YouTube wins (it streams properly and doesn't
  // burn Drive quota), falling back to the Drive file when there's no upload yet.
  const embed = row.youtubeUrl ? youtubeEmbedUrl(row.youtubeUrl) : null;
  if (embed) {
    items.push({
      id: `yt:${row.trackingId}`,
      kind: 'video',
      label: 'Video',
      driveId: row.videoFileId || null, // still useful as a poster frame
      youtubeUrl: embed
    });
  } else if (row.videoFileId) {
    items.push({ id: row.videoFileId, kind: 'video', label: 'Video', driveId: row.videoFileId });
  }

  return items;
}

/** What the Media column should render. Purged/none are distinct states, not both "empty". */
export type MediaState = 'purged' | 'none' | 'present';

export function mediaState(row: DeliveryRow): MediaState {
  if (row.filesDeleted) return 'purged';
  return mediaItems(row).length > 0 ? 'present' : 'none';
}

// ---------------------------------------------------------------------------
// Dates
//
// Three real timestamps exist per delivery, and they answer different questions:
//   added   — Date + Time columns. handleCustomerLookup labels this exact pair
//             "packedAt", so it's genuinely when the parcel was packed and the
//             media shot, not a generic row-creation stamp.
//   status  — Status Date. When Shopify last moved the delivery status.
//   purged  — the Files Deleted stamp. When the archiver removed the media.
//
// There is deliberately no "downloaded" date: nothing in the sheet or Apps
// Script records a download event, so any such column would be invented.
// ---------------------------------------------------------------------------

/** Date + Time columns parsed together. Null when the row predates them or they're malformed. */
export function addedAt(row: DeliveryRow): Date | null {
  if (!row.createdDate) return null;
  const d = new Date(`${row.createdDate}T${row.createdTime || '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * statusDate arrives as a full JS Date.toString(), e.g.
 * "Wed Sep 02 2026 10:02:00 GMT+0530 (India Standard Time)".
 */
export function statusAt(row: DeliveryRow): Date | null {
  if (!row.statusDate) return null;
  const d = new Date(row.statusDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The Files Deleted stamp. It's written by the archiver and its exact format
 * isn't guaranteed to parse — callers fall back to showing the raw string, so
 * a non-empty-but-unparseable stamp still reads as "purged", never as "live".
 */
export function purgedAt(row: DeliveryRow): Date | null {
  if (!row.filesDeleted) return null;
  const d = new Date(row.filesDeleted);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Sep 2, 10:02 AM" — scannable in a table cell. */
export function formatDateTime(d: Date | null): string {
  if (!d) return '—';
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

/** "2 Sep 2026, 10:02 AM" — unambiguous, for the viewer and hover titles. */
export function formatFullDateTime(d: Date | null): string {
  if (!d) return '—';
  return (
    d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  );
}

/** "3d ago" / "just now". Relative time is what "is this stale?" actually asks. */
export function formatRelative(d: Date | null): string {
  if (!d) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

// ---------------------------------------------------------------------------
// Order-name matching
//
// Order names are "#Dropy-3977" today, and sub-orders take the form
// "#Dropy-1642-1-1" (a split shipment of parent order 1642). Plain substring
// matching gets this wrong in both directions: searching "1642" would also hit
// "#Dropy-16420", and searching "1642-1-1" would miss nothing but tells you
// nothing about siblings.
//
// So the numeric tail is compared SEGMENT BY SEGMENT:
//   query 1642      matches 1642, 1642-1-1, 1642-2-1   (parent + all children)
//   query 1642-1-1  matches 1642-1-1 only               (that exact sub-order)
//   query 1642      does NOT match 16420                (segment boundary)
// ---------------------------------------------------------------------------

/** The numeric tail of an order name, split into segments. "#Dropy-1642-1-1" -> ['1642','1','1'] */
export function orderSegments(name: string): string[] {
  const bare = String(name || '').trim().replace(/^#/, '');
  // Anchored at the end so a prefix like "Dropy" is ignored without hardcoding it.
  const m = bare.match(/(\d+(?:[-_]\d+)*)\s*$/);
  return m ? m[1].split(/[-_]/) : [];
}

/**
 * True when `query` identifies `orderName` — exactly, or as its parent order.
 * Returns false when the query has no numeric part, so callers fall back to
 * ordinary text search for things like a customer name.
 */
export function orderMatches(orderName: string, query: string): boolean {
  const qs = orderSegments(query);
  if (qs.length === 0) return false;
  const os = orderSegments(orderName);
  if (os.length === 0) return false;
  // A query can be shorter (a parent), never longer, than the order it matches.
  if (qs.length > os.length) return false;
  return qs.every((seg, i) => seg === os[i]);
}
