// ═══════════════════════════════════════════════════════════════════════════
//  WHY THIS FILE EXISTS
//
//  The dashboard's Overview and Deliveries pages ask the main script for a
//  whole-sheet summary via:
//
//      ?action=admin&key=...&job=stats
//
//  Against the live deployment that returns, in ~1.6s:
//
//      {"success":false,"error":"ReferenceError: handleAdmin is not defined"}
//
//  i.e. route_() has `case 'admin': return handleAdmin(...)` but no
//  handleAdmin exists in the deployed project. That's why every stats panel
//  in the dashboard reads "Sheet stats unavailable" — it was never a timeout.
//
//  This file defines a self-contained `handleDashboardStats` that computes the
//  same numbers the dashboard's StatsResponse type already expects, without
//  depending on handleAdmin or any other missing function.
//
//  ── INSTALL ───────────────────────────────────────────────────────────────
//  1. Add this file to the MAIN script project (the one with DROPPY-Log,
//     FOLDER_ID, ADMIN_KEY — the same project 1-dashboardData.gs went into).
//  2. In that project's route_(e) switch, add this line:
//
//         case 'dashboardStats': return handleDashboardStats(e.parameter);
//
//     Add it as a NEW case — don't touch the existing `admin` case.
//  3. Re-deploy: Deploy → Manage deployments → Edit → New version → Deploy.
//
//  No env var changes are needed; lib/appsScript.ts already points at this
//  action.
// ═══════════════════════════════════════════════════════════════════════════

function handleDashboardStats(params) {
  try {
    // Same key gate the other admin-ish endpoints use. ADMIN_KEY is a script
    // property in this project; the dashboard sends it from the server side
    // only, so it never reaches the browser.
    var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
    if (expected && String(params.key || '') !== String(expected)) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    var sheet = SpreadsheetApp.openById(SHEET_ID_FOR_STATS_()).getSheetByName(SHEET_NAME_FOR_STATS_());
    if (!sheet) return jsonResponse({ success: false, error: 'Log sheet not found' });

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2) {
      return jsonResponse(emptyStats_());
    }

    // One bulk read. Reading cell-by-cell across thousands of rows is what
    // makes Apps Script endpoints slow enough to actually time out.
    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var header = values[0];
    var col = {};
    for (var h = 0; h < header.length; h++) col[String(header[h]).trim()] = h;

    function cell(row, name) {
      var i = col[name];
      return i === undefined ? '' : String(row[i] === null || row[i] === undefined ? '' : row[i]).trim();
    }

    var s = emptyStats_();
    s.success = true;

    // Retention window for "purgeable now". Kept as a script property so it
    // matches whatever the archiver uses; falls back to 30 days.
    var retentionDays = Number(
      PropertiesService.getScriptProperties().getProperty('RETENTION_DAYS') || 30
    );
    var cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (var r = 1; r < values.length; r++) {
      var row = values[r];

      var tracking = cell(row, 'Tracking ID');
      var orderName = cell(row, 'Order Name');
      var customer = cell(row, 'Customer Name');
      var driveAccount = cell(row, 'Drive Account');
      var status = cell(row, 'Delivery Status');
      var statusDate = cell(row, 'Status Date');
      var videoId = cell(row, 'Video File ID');
      var frontId = cell(row, 'Front Photo ID');
      var filesDeleted = cell(row, 'Files Deleted');

      // A fully blank trailing row (common when rows get cleared rather than
      // deleted) is not a delivery — counting it would inflate every number.
      if (!tracking && !orderName && !customer && !status) continue;

      s.totalRows++;

      if (!tracking) s.blankTracking++;
      if (!orderName) {
        s.blankOrderName++;
        // +1 twice: array is 0-based and the header occupies row 1, so the
        // sheet row a human sees is r + 1.
        if (s.blankOrderNameRows.length < 500) {
          s.blankOrderNameRows.push((r + 1) + ':' + (tracking || '(no tracking id)'));
        }
      }
      if (!customer) s.blankCustomer++;
      if (!driveAccount) s.blankDriveAccount++;
      if (!status) s.blankDeliveryStatus++;
      if (!videoId) s.blankVideoId++;

      var isDelivered = status.toLowerCase().indexOf('delivered') === 0;
      if (isDelivered) {
        s.delivered++;
        if (!statusDate) s.deliveredNoStatusDate++;
        if (!driveAccount) s.deliveredNoDriveAccount++;
        if (!videoId && !frontId) s.deliveredNoFileIds++;
      }

      if (filesDeleted) {
        s.alreadyPurged++;
      } else if (isDelivered && statusDate) {
        // Purgeable = delivered long enough ago that the media is past
        // retention, and not already purged.
        var d = new Date(statusDate);
        if (!isNaN(d.getTime()) && d.getTime() < cutoff && (videoId || frontId)) {
          s.purgeableNow++;
        }
      }
    }

    return jsonResponse(s);
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function emptyStats_() {
  return {
    success: true,
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

// These two mirror however the main project already locates its log sheet.
// They're separate functions so that if your project names them differently,
// this file is the only place to adjust — nothing above changes.
function SHEET_ID_FOR_STATS_() {
  var p = PropertiesService.getScriptProperties();
  // Prefer an explicit property; fall back to the active spreadsheet, which is
  // correct when this script is container-bound to the log sheet.
  return p.getProperty('SHEET_ID') || SpreadsheetApp.getActiveSpreadsheet().getId();
}

function SHEET_NAME_FOR_STATS_() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty('SHEET_NAME') || 'DROPPY-Log';
}
