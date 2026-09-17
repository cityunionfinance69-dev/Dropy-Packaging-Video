// This file is the ONLY place in the whole app that knows how to talk to Apps
// Script. Everything above it (API routes, components) works with clean
// TypeScript types and has no idea Google Sheets or Apps Script exist.
//
// That boundary matters: if you later swap the sheet for a real database, or
// add a caching layer, this is the only file that changes.

export type DeliveryRow = {
  trackingId: string;
  orderName: string;
  customerName: string;
  items: string;
  totalPrice: string;
  deliveryStatus: string;
  statusDate: string;
  driveAccount: string;
  videoFileId: string;
  frontPhotoId: string;
  backPhotoId: string;
  labelPhotoId: string;
  youtubeUrl: string;
  createdDate: string;
  createdTime: string;
  filesDeleted: string;
  // Blank on rows written before the Folder ID column existed, and on rows
  // written via logDelivery/doPost, which never resolve a per-tracking-ID
  // Drive subfolder.
  folderId: string;
  hasMedia: boolean;
};

export type DeliveriesResponse = {
  success: boolean;
  totalRows: number;
  /** Rows this query can page through — the match count when searching. */
  matchCount?: number;
  /** True when the server applied a search rather than returning a plain page. */
  searched?: boolean;
  offset: number;
  limit: number;
  hasMore: boolean;
  rows: DeliveryRow[];
  error?: string;
};

export type QuotaResponse = {
  success: boolean;
  account: string;
  limitBytes: number;
  usedBytes: number;
  freeBytes: number;
  hasRoom: boolean;
  error?: string;
};

export type StorageAccountConfig = { label: string; url: string };

// Mirrors sheetStats_() in your existing Code.gs — no new endpoint needed,
// this hits ?action=admin&job=stats, which already exists.
export type StatsResponse = {
  success: boolean;
  totalRows: number;
  blankTracking: number;
  blankOrderName: number;
  blankCustomer: number;
  blankDriveAccount: number;
  blankDeliveryStatus: number;
  blankVideoId: number;
  delivered: number;
  deliveredNoStatusDate: number;
  deliveredNoDriveAccount: number;
  deliveredNoFileIds: number;
  alreadyPurged: number;
  purgeableNow: number;
  blankOrderNameRows: string[];
  error?: string;
};

function requireEnv(name: string): string {
  // Trimmed because a value pasted into a hosting dashboard often carries a
  // trailing newline or space, and an untrimmed URL or key silently corrupts
  // every request built from it — a 404 or 401 that looks like a broken
  // endpoint rather than a stray character.
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Reads DROPPY_STORAGE_ACCOUNTS once and validates its shape, so a malformed
 *  env var fails loudly at request time instead of silently returning []. */
export function getStorageAccounts(): StorageAccountConfig[] {
  const raw = process.env.DROPPY_STORAGE_ACCOUNTS;
  if (!raw) return [];

  // Pasting a 1.5KB JSON array into a hosting dashboard's env-var box goes
  // wrong in predictable ways, and a bare JSON.parse turns every one of them
  // into an unhandled SyntaxError that takes down the whole page render —
  // observed in production as "Unexpected non-whitespace character after JSON
  // at position 1480", i.e. the array parsed fine and something followed it on
  // a second line.
  //
  // Normalising first fixes the three common cases:
  //   * the textarea appended a newline, or the value was pasted with trailing
  //     commentary after it
  //   * the whole value got wrapped in quotes, the way it appears in a .env file
  //   * smart quotes, if it travelled through a document or chat app
  let text = raw.trim();

  // Strip wrapping quotes only when they enclose the entire value.
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }

  // Keep only the outermost array. Anything after the closing bracket is
  // paste debris, and anything before it is a stray prefix.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) text = text.slice(start, end + 1);

  // Curly quotes are never valid JSON but survive a copy through a doc or chat.
  text = text.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // A thrown SyntaxError here previously crashed the page. Report the
    // misconfiguration and let the dashboard render without storage cards —
    // the delivery table and sheet health do not depend on this value.
    console.error('DROPPY_STORAGE_ACCOUNTS is not valid JSON:', err);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.error('DROPPY_STORAGE_ACCOUNTS must be a JSON array; got', typeof parsed);
    return [];
  }

  // Drop entries missing the two fields every caller needs, rather than letting
  // an undefined url become the string "undefined" in a fetch.
  return parsed.filter(
    (a): a is StorageAccountConfig =>
      Boolean(a) && typeof a === 'object' && typeof (a as StorageAccountConfig).url === 'string'
  );
}

/** Generic fetch-JSON-from-Apps-Script with a timeout and one retry.
 *
 *  Two things make Apps Script unreliable in a way a plain fetch handles badly:
 *
 *  1. COLD STARTS. A script that hasn't run recently can take well over 10s to
 *     respond at all. The old 10s ceiling turned every cold start into a hard
 *     failure ("This operation was aborted"), which is why storage cards and
 *     the whole sheet-health panel would vanish on an otherwise healthy load.
 *
 *  2. CONCURRENCY CONTENTION. Several accounts queried at once can make some
 *     of them 502 or hang, and the same request almost always succeeds moments
 *     later — the same behaviour the delivery table already compensates for
 *     with its own retry (see fetchDeliveriesWithRetry in DeliveryTable).
 *
 *  So: a realistic timeout, plus one retry with a short backoff. A retry costs
 *  a few seconds on a genuinely dead endpoint but rescues the common transient
 *  case, which is the right trade for a dashboard that's useless when blank.
 */
async function fetchJsonOnce<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Read as text first, then parse.
    //
    // Apps Script does not always answer with JSON: a deployment that is
    // unavailable, still propagating, or hit while Google is rate-limiting
    // returns an HTML error page — observed live from one storage account,
    // where res.json() threw a bare SyntaxError that said nothing about the
    // endpoint or the response. Parsing ourselves lets the failure name what
    // actually arrived.
    const body = await res.text();
    try {
      return JSON.parse(body) as T;
    } catch {
      const looksLikeHtml = /^\s*<(!doctype|html)/i.test(body);
      throw new Error(
        looksLikeHtml
          ? 'Apps Script returned an HTML error page instead of JSON — the deployment may be unavailable or still propagating.'
          : `Apps Script returned a non-JSON response (${body.slice(0, 80).replace(/\s+/g, ' ')}…)`
      );
    }
  } catch (err) {
    // AbortError's own message ("This operation was aborted") says nothing
    // about WHY, and it was surfacing raw in the storage cards. Name the cause.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  try {
    return await fetchJsonOnce<T>(url, timeoutMs);
  } catch (err) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      return await fetchJsonOnce<T>(url, timeoutMs);
    } catch {
      // Report the FIRST failure: it's the one that describes the normal
      // condition, while the retry's error can be noise from the backoff race.
      throw err;
    }
  }
}

export async function fetchDeliveries(offset: number, limit: number, q = ''): Promise<DeliveriesResponse> {
  const base = requireEnv('DROPPY_MAIN_URL');
  const key = requireEnv('DROPPY_ADMIN_KEY');
  const url =
    `${base}?action=dashboardData&key=${encodeURIComponent(key)}&offset=${offset}&limit=${limit}` +
    (q ? `&q=${encodeURIComponent(q)}` : '');
  return fetchJson<DeliveriesResponse>(url);
}

/** Whole-sheet summary.
 *
 *  Tries `action=dashboardStats` (see apps-script-additions/3-stats.gs) first,
 *  and falls back to the older `action=admin&job=stats` if that action isn't
 *  deployed yet, so the dashboard works before AND after that file is added.
 *
 *  Why the new action exists at all: the live deployment answers the admin
 *  route with `ReferenceError: handleAdmin is not defined` — route_() has a
 *  `case 'admin'` but the function was never deployed. Apps Script returns
 *  that as HTTP 200 with {success:false, error:...}, so it can't be detected
 *  as a transport failure; it has to be checked in the body.
 */
async function fetchStatsFrom(url: string): Promise<StatsResponse> {
  // Walks every row, so it's the slowest call in the app — the longest ceiling.
  return fetchJson<StatsResponse>(url, 55_000);
}

export async function fetchStats(): Promise<StatsResponse> {
  const base = requireEnv('DROPPY_MAIN_URL');
  const key = requireEnv('DROPPY_ADMIN_KEY');
  const k = encodeURIComponent(key);

  try {
    const fresh = await fetchStatsFrom(`${base}?action=dashboardStats&key=${k}`);
    if (fresh.success) return fresh;
  } catch {
    // fall through to the legacy endpoint
  }

  try {
    const legacy = await fetchStatsFrom(`${base}?action=admin&key=${k}&job=stats`);
    if (legacy.success) return legacy;
    return {
      ...legacy,
      success: false,
      error:
        legacy.error && legacy.error.includes('handleAdmin')
          ? 'The stats endpoint is not deployed — add apps-script-additions/3-stats.gs to your main Apps Script project and re-deploy.'
          : legacy.error
    };
  } catch (err) {
    return {
      ...(await Promise.resolve(emptyStats())),
      success: false,
      error: err instanceof Error ? err.message : 'Stats unavailable'
    };
  }
}

/** Zero-filled stats, so a failed fetch still returns a well-formed object
 *  instead of forcing every caller to null-check each field. */
function emptyStats(): StatsResponse {
  return {
    success: false,
    totalRows: 0,
    blankTracking: 0,
    blankOrderName: 0,
    blankCustomer: 0,
    blankDriveAccount: 0,
    blankDeliveryStatus: 0,
    blankVideoId: 0,
    delivered: 0,
    deliveredNoStatusDate: 0,
    deliveredNoDriveAccount: 0,
    deliveredNoFileIds: 0,
    alreadyPurged: 0,
    purgeableNow: 0,
    blankOrderNameRows: []
  };
}

/** One account's quota, never throwing — a failure becomes a well-formed
 *  unsuccessful QuotaResponse instead.
 *
 *  Exists so each storage card can be its own <Suspense> boundary and stream
 *  independently. Measured live: 9 of 10 accounts answer in ~2s while one can
 *  take 60s+ (Google-side, not ours — a single un-retried attempt). Fetching
 *  them as one batch meant every card waited on that outlier.
 *
 *  Note the shorter timeout and NO retry: an account that hasn't answered in
 *  20s isn't going to, and retrying it only doubles the wait for a card whose
 *  neighbours have long since rendered.
 */
export async function fetchQuota(acct: StorageAccountConfig): Promise<QuotaResponse & { label: string }> {
  try {
    // 45s, not 20s: one account measures 11-38s while the other nine answer in
    // about two. Each card has its own Suspense boundary, so the slow one
    // delays only itself — cutting it off at 20s turned a slow-but-working
    // account into an "unreachable" card, which is worse information.
    let data: QuotaResponse;
    try {
      data = await fetchJsonOnce<QuotaResponse>(`${acct.url}?action=capacity`, 45_000);
    } catch (first) {
      // Google intermittently answers with an HTML error page; the same request
      // usually succeeds moments later. Reads are safe to retry.
      if (first instanceof Error && /HTML error page|non-JSON/.test(first.message)) {
        await new Promise((r) => setTimeout(r, 800));
        data = await fetchJsonOnce<QuotaResponse>(`${acct.url}?action=capacity`, 45_000);
      } else {
        throw first;
      }
    }
    return { ...data, label: acct.label };
  } catch (err) {
    return {
      success: false,
      account: acct.label,
      label: acct.label,
      limitBytes: 0,
      usedBytes: 0,
      freeBytes: 0,
      hasRoom: false,
      error: err instanceof Error ? err.message : 'unreachable'
    };
  }
}

/** Queries every configured storage account IN PARALLEL, not one after another.
 *  Sequential awaits here would mean total load time = sum of every account's
 *  latency; Promise.allSettled means it's the SLOWEST single account instead.
 *  Uses allSettled (not all) so one dead account doesn't blank the whole card row.
 *
 *  Hits the storage script's EXISTING `capacity` action — no new endpoint, no
 *  key needed (capacity_() isn't gated by requireKey_, unlike meta/purge). */
export async function fetchAllQuotas(): Promise<Array<QuotaResponse & { label: string }>> {
  const accounts = getStorageAccounts();
  const results = await Promise.allSettled(
    accounts.map(async (acct) => {
      const url = `${acct.url}?action=capacity`;
      const data = await fetchJson<QuotaResponse>(url);
      return { ...data, label: acct.label };
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          success: false,
          account: accounts[i].label,
          label: accounts[i].label,
          limitBytes: 0,
          usedBytes: 0,
          freeBytes: 0,
          hasRoom: false,
          error: r.reason instanceof Error ? r.reason.message : 'unreachable'
        }
  );
}

export type AssignOrderResponse = {
  success: boolean;
  trackingId?: string;
  row?: number;
  orderName?: string;
  customerName?: string;
  written?: string[];
  error?: string;
  /** True when the order number was recorded without a Shopify lookup. */
  unverified?: boolean;
  /** Split-shipment tail, e.g. "-1-1". */
  parcel?: string;
  /** Human note explaining what an unverified save did and did not fill in. */
  note?: string;
};

/**
 * Attach an existing Shopify order to a delivery row that never got matched.
 *
 * Writes to the sheet, so it is deliberately not part of any page render path —
 * only the POST /api/assign-order route calls it.
 *
 * No retry: fetchJson's retry is safe for reads, but silently re-sending a
 * write after an ambiguous failure could double-apply it. One attempt, with a
 * long ceiling because this does a live Shopify lookup plus a sheet scan.
 */
export async function assignOrder(
  trackingId: string,
  orderName: string,
  force = false,
  /**
   * Record the order number WITHOUT asking Shopify. Only for when the token is
   * rejected: it writes Order Name alone and leaves customer/items/price blank
   * rather than guessing them.
   */
  unverified = false
): Promise<AssignOrderResponse> {
  const base = requireEnv('DROPPY_MAIN_URL');
  const key = requireEnv('DROPPY_ADMIN_KEY');
  const url =
    `${base}?action=assignOrder&key=${encodeURIComponent(key)}` +
    `&trackingId=${encodeURIComponent(trackingId)}` +
    `&orderName=${encodeURIComponent(orderName)}` +
    (force ? '&force=true' : '') +
    (unverified ? '&unverified=true' : '');

  const res = await fetchJsonOnce<AssignOrderResponse>(url, 45_000);

  // An undeployed endpoint falls through route_()'s default case, which returns
  // {status:'ok'} with no success field — that would otherwise read as a
  // silent no-op success.
  if (res && typeof res.success === 'undefined') {
    return {
      success: false,
      error:
        'The assignOrder endpoint is not deployed — add apps-script-additions/4-assignOrder.gs to your main Apps Script project and re-deploy.'
    };
  }
  if (!res.success && res.error && res.error.includes('is not defined')) {
    return {
      success: false,
      error:
        'The assignOrder endpoint is not deployed — add apps-script-additions/4-assignOrder.gs to your main Apps Script project and re-deploy.'
    };
  }
  return res;
}

export type ShopifyPingResponse = { success: boolean; shopifyOk?: boolean; shop?: string; reason?: string; error?: string };

/**
 * Is the Shopify credential alive?
 *
 * Worth its own call because a dead token breaks four things at once — order
 * matching on new deliveries, repairDeliveryRows(), dailyStatusRefresh() and
 * assignOrder — each failing in a different-looking way, so without this the
 * cause only surfaces when someone happens to try an assign.
 *
 * Never throws: a failure to even ask is reported as "not ok" with the reason,
 * since the banner is advisory and must never break a page render.
 */
export async function fetchShopifyPing(): Promise<ShopifyPingResponse> {
  try {
    const base = requireEnv('DROPPY_MAIN_URL');
    const key = requireEnv('DROPPY_ADMIN_KEY');
    const res = await fetchJsonOnce<ShopifyPingResponse>(
      `${base}?action=shopifyPing&key=${encodeURIComponent(key)}`,
      20_000
    );
    // An undeployed endpoint falls through route_()'s default case and returns
    // {status:'ok'} with no shopifyOk — treat that as "unknown", not "broken",
    // so a stale deployment doesn't raise a false alarm about the token.
    if (typeof res.shopifyOk !== 'boolean') return { success: false };
    return res;
  } catch {
    return { success: false };
  }
}
