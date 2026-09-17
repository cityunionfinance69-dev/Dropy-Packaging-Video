# Droppy Ops Dashboard

Next.js dashboard reading live data from your existing Apps Script — no database, no
duplicated business logic. See `apps-script-additions/` for the two small endpoints
this needs added to your Google scripts.

## 1. Wire up Apps Script (do this first — the dashboard has nothing to show without it)

**Main script** (the one with `DROPPY-Log`, `FOLDER_ID`, `ADMIN_KEY`):
1. Add `apps-script-additions/1-dashboardData.gs` as a new file in that project.
2. In your existing `route_(e)` switch statement, add:
   ```js
   case 'dashboardData': return handleDashboardData(e.parameter);
   ```
3. Re-deploy (Deploy → Manage deployments → Edit → New version).

**Stats endpoint (required — this is why "Sheet stats unavailable" appears):**

Your deployed script routes `action=admin` to a `handleAdmin` function that
does not exist in the deployment — hitting it returns, in ~1.6s:

```json
{"success":false,"error":"ReferenceError: handleAdmin is not defined"}
```

That single missing function is what blanks the stats panels on Overview,
Deliveries and Health. To fix it:

1. Add `apps-script-additions/3-stats.gs` as a new file in the main project.
2. Add to that project's `route_(e)` switch:
   ```js
   case 'dashboardStats': return handleDashboardStats(e.parameter);
   ```
3. Re-deploy (Deploy → Manage deployments → Edit → New version).

The dashboard tries `dashboardStats` first and falls back to the old
`admin&job=stats`, so it keeps working either way.

**Assign-order endpoint (optional — needed to fix unmatched rows from the dashboard):**

Rows where Shopify never matched a tracking ID show an `unmatched` button in the
Order column. Clicking it lets you type the order number; Apps Script then looks
that order up in Shopify **by name** and writes the real order data into the row.
Nothing is invented — an unknown order number is rejected.

1. Add `apps-script-additions/4-assignOrder.gs` to the main project.
2. Add to that project's `route_(e)` switch:
   ```js
   case 'assignOrder': return handleAssignOrder(e.parameter);
   ```
3. Re-deploy.

Until it's deployed, the dashboard says so instead of failing silently.

Order numbers are matched by segment, so sub-orders work both ways: searching
`1642` finds `#Dropy-1642` and every sub-order (`1642-1-1`, `1642-2-1`), while
`1642-1-1` finds only that one. `16420` never matches `1642`.

**Each storage account script** (the ones handling `meta`/`purge`):
1. Enable the Drive API advanced service (Services → + → "Drive API").
2. Add `apps-script-additions/2-quota.gs`.
3. Add `case 'quota': return handleQuota(e.parameter);` to that script's `route_(e)`.
4. Re-deploy.

Note each deployment's `/exec` URL — you'll need them in step 3 below.

## 2. Local development

```bash
npm install
cp .env.example .env.local
# edit .env.local with your real URLs and keys
npm run dev
```

Open http://localhost:3000 — Overview should show live storage bars and health counts.

## 3. Deploy to Vercel

```bash
npm i -g vercel   # if you don't have it
vercel
```

Then in the Vercel dashboard → your project → Settings → Environment Variables, add
the same three keys from `.env.example` (`DROPPY_MAIN_URL`, `DROPPY_ADMIN_KEY`,
`DROPPY_STORAGE_ACCOUNTS`) for the Production environment, and redeploy.

## Project structure (what lives where, and why)

```
app/
  page.tsx              Overview — server component, fetches directly, no client JS
  deliveries/page.tsx    Deliveries — thin wrapper around the client table
  health/page.tsx        Health — row-level detail behind Overview's counts
  api/deliveries/        Proxy route: browser → here → Apps Script (hides ADMIN_KEY)
  api/quota/              Same, for storage account quotas
lib/appsScript.ts        The ONLY file that knows how to talk to Apps Script
components/               Presentational + one interactive client component
apps-script-additions/    Paste these into your existing .gs projects (see step 1)
```

## Extending this later

- **Supabase caching**: if Apps Script starts feeling slow under dashboard load, add
  a Supabase table that a scheduled job (Vercel Cron, or your existing daily Apps
  Script trigger) writes a snapshot into, and point `lib/appsScript.ts` at Supabase
  instead. The API routes and components don't need to change — that's the whole
  point of keeping that boundary in one file.
- **Storage trend over time**: once you have snapshots in Supabase, a simple line
  chart on Overview showing used-space-per-day becomes a small addition.
- **Auth**: right now anyone with the deployed URL sees your dashboard. Add
  Vercel's password protection (Pro plan) or a simple middleware.ts checking a
  cookie if you want to lock it down further.
