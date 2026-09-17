// ═══════════════════════════════════════════
//  NOTE: This file was pasted into chat by the project owner and saved here for
//  reference/patching. The paste was truncated partway through handlePurge()
//  (in the retention/archive section, near the end) — everything above that
//  point, including HEADERS, buildRow, resolveTargetFolder, handleUploadComplete,
//  handleLogDelivery, and getOrCreateSheet, is complete and unmodified from the
//  paste except where marked "PATCH:" below for the Folder ID feature.
//
//  This is NOT deployed anywhere — it's a local copy for patching. After review,
//  apply the same PATCH: changes to your live Apps Script project's Code.gs.
// ═══════════════════════════════════════════

function formatCell_(value) {
  if (value instanceof Date) {
    var isTimeOnly = value.getFullYear() === 1899 && value.getMonth() === 11 && value.getDate() === 30;
    return Utilities.formatDate(value, Session.getScriptTimeZone(), isTimeOnly ? 'HH:mm:ss' : 'yyyy-MM-dd');
  }
  return String(value || '');
}

// PATCH: 'Folder ID' appended to HEADERS — new columns must always be APPENDED
// (see the comment on ensureColumns below), never inserted, so existing rows
// stay column-aligned.
var HEADERS = ['Date','Time','Tracking ID','Order Name','Customer Name','Customer Phone','Customer Email',
  'Items','Total Price','Fulfillment Status','Financial Status','Tracking URL','Tracking Company',
  'Order Date','Video File ID','Front Photo ID','Back Photo ID','Label Photo ID','YouTube URL',
  'Drive Account','Delivery Status','Status Date','Files Deleted','Folder ID'];

var FILE_COL_MAP = { video:'Video File ID', front:'Front Photo ID', back:'Back Photo ID', label:'Label Photo ID' };

// Columns filled from Shopify — rewritten wholesale by repairDeliveryRows() when a row turns out to
// hold the wrong order. File IDs / Drive Account / Date / Time / Folder ID are never touched by repair.
var SHOPIFY_COLS = ['Order Name','Customer Name','Customer Phone','Customer Email','Items','Total Price',
  'Fulfillment Status','Financial Status','Tracking URL','Tracking Company','Order Date',
  'Delivery Status','Status Date'];

/**
 * Build a full sheet row. Single source of truth for column order — every writer goes through here,
 * so adding a column to HEADERS can't leave one code path writing a short/shifted row.
 *
 * PATCH: added folderId param (optional, defaults to '' so existing callers that don't pass it
 * still work — they just leave the column blank until the next write that does).
 */
function buildRow(trackingId, sd, ids, youtubeUrl, driveAccount, folderId) {
  ids = ids || {};
  var now = new Date();
  var vals = {
    'Date':               Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    'Time':               Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm:ss'),
    'Tracking ID':        trackingId,
    'Order Name':         sd ? sd.orderName : '',
    'Customer Name':      sd ? sd.customerName : '',
    'Customer Phone':     sd ? sd.customerPhone : '',
    'Customer Email':     sd ? sd.customerEmail : '',
    'Items':              sd ? sd.itemsStr : '',
    'Total Price':        sd ? (sd.currency + ' ' + sd.totalPrice) : '',
    'Fulfillment Status': sd ? sd.fulfillmentStatus : '',
    'Financial Status':   sd ? sd.financialStatus : '',
    'Tracking URL':       sd ? sd.trackingUrl : '',
    'Tracking Company':   sd ? sd.trackingCompany : '',
    'Order Date':         sd ? sd.orderDate : '',
    'Video File ID':      ids.video || '',
    'Front Photo ID':     ids.front || '',
    'Back Photo ID':      ids.back  || '',
    'Label Photo ID':     ids.label || '',
    'YouTube URL':        youtubeUrl || '',
    'Drive Account':      driveAccount || '',
    'Delivery Status':    sd ? buildDeliveryStatus(sd) : '',
    'Status Date':        sd ? formatShopifyDate(sd.statusDate) : '',
    'Files Deleted':      '',    // set by the archiver once the media is archived + purged
    'Folder ID':          folderId || ''
  };
  var row = [];
  for (var i = 0; i < HEADERS.length; i++) row.push(vals[HEADERS[i]] !== undefined ? vals[HEADERS[i]] : '');
  return row;
}

function buildDeliveryStatus(sd) {
  var DELIVERY = {
    DELIVERED:'Delivered', OUT_FOR_DELIVERY:'Out for Delivery', IN_TRANSIT:'In Transit',
    ATTEMPTED_DELIVERY:'Delivery Attempted', FAILURE:'Delivery Failed', CANCELED:'Canceled',
    READY_FOR_PICKUP:'Ready for Pickup', PICKED_UP:'Picked Up', LABEL_PRINTED:'Label Printed',
    LABEL_PURCHASED:'Label Purchased', CONFIRMED:'Confirmed', SUBMITTED:'Submitted',
    FULFILLED:'Shipped', LABEL_VOIDED:'Label Voided', MARKED_AS_FULFILLED:'Marked as Fulfilled'
  };
  var ORDER_LEVEL = {
    FULFILLED:'Shipped', UNFULFILLED:'Unfulfilled', PARTIALLY_FULFILLED:'Partially Shipped',
    IN_PROGRESS:'In Progress', ON_HOLD:'On Hold', SCHEDULED:'Scheduled', OPEN:'Open',
    PENDING_FULFILLMENT:'Pending Fulfillment'
  };
  var PAYMENT = {
    PENDING:'Payment Pending', PARTIALLY_PAID:'Partially Paid', AUTHORIZED:'Payment Authorized',
    REFUNDED:'Refunded', PARTIALLY_REFUNDED:'Partially Refunded', VOIDED:'Voided', EXPIRED:'Payment Expired'
  };

  var d = String(sd.fulfillmentDisplayStatus || '').toUpperCase();
  var f = String(sd.fulfillmentStatus || '').toUpperCase();
  var status = DELIVERY[d] || ORDER_LEVEL[f] || (f ? titleCase(f) : 'Unfulfilled');

  var pay = PAYMENT[String(sd.financialStatus || '').toUpperCase()];
  return pay ? (status + ' · ' + pay) : status;
}

function titleCase(s) {
  return String(s).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function formatShopifyDate(iso) {
  if (!iso) return '';
  try { return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }
  catch (e) { return String(iso); }
}

// ═══════════════════════════════════════════
//  doGet
// ═══════════════════════════════════════════

function thisAccountEmail_() {
  try {
    var e = Session.getEffectiveUser().getEmail();
    if (e) return e;
  } catch (err) { /* scope not granted — fall through */ }
  try {
    var owner = DriveApp.getFolderById(FOLDER_ID).getOwner();
    return owner ? (owner.getEmail() || '') : '';
  } catch (err2) { return ''; }
}

function doGet(e) {
  try {
    return route_(e);
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return jsonResponse({ success: false, error: String(err).slice(0, 300) });
  }
}

function route_(e) {
  var action = (e && e.parameter) ? e.parameter.action : '';
  switch (action) {
    case 'lookup':         return handleCustomerLookup(e.parameter);
    case 'getUploadUrl':   return handleGetUploadUrl(e.parameter);
    case 'uploadComplete': return handleUploadComplete(e.parameter);
    case 'setYoutubeUrl':  return handleSetYoutubeUrl(e.parameter);
    case 'logDelivery':    return handleLogDelivery(e.parameter);   // <-- NEW (multi-account)
    case 'admin':          return handleAdmin(e.parameter);         // <-- audit/repair/refresh over HTTP
    case 'meta':           return handleMeta(e.parameter);          // <-- legacy files stored on THIS account
    case 'purge':          return handlePurge(e.parameter);         // <-- PERMANENT delete, archiver only
    case 'dashboardData':  return handleDashboardData(e.parameter); // <-- NEW (Next.js dashboard)
    default:
      if (e && e.parameter && e.parameter.verify) return handleVerify(e.parameter);
      return jsonResponse({ status: 'ok', version: 'v9.3' });
  }
}

// ═══════════════════════════════════════════
//  NEW — logDelivery: write a delivery's Drive file IDs into its single row.
//  The files live on a STORAGE account (already shared "anyone with link");
//  this only touches the sheet — no DriveApp access to those file IDs.
//    ?action=logDelivery&trackingId=..&folder=DD.MM.YYYY-..
//        &videoId=..&frontId=..&backId=..&labelId=..&driveAccount=storage3@gmail.com
//
//  PATCH: logDelivery's files live on a STORAGE account's Drive, not this script's
//  own DriveApp — this script never had a folder object to read an ID from here
//  in the first place, only the folder NAME passed in `params.folder`. There is
//  no live folder ID to capture on this path; leave its Folder ID cell blank
//  (uploadComplete is the path that actually creates the folder on this account
//  and can capture a real ID — see PATCH there).
// ═══════════════════════════════════════════

function handleLogDelivery(params) {
  var trackingId = (params.trackingId || '').trim();
  var folderName = (params.folder || '').trim();
  if (!trackingId && folderName) trackingId = extractTrackingId(folderName);
  if (!trackingId) return jsonResponse({ success: false, error: 'trackingId required' });

  var ids = {
    video: (params.videoId || '').trim(),
    front: (params.frontId || '').trim(),
    back:  (params.backId  || '').trim(),
    label: (params.labelId || '').trim()
  };
  var driveAccount = (params.driveAccount || '').trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var parentFolder = DriveApp.getFolderById(FOLDER_ID);
    var sheet = getOrCreateSheet(parentFolder).sheet;
    var existingRow = findRowByTrackingId(sheet, trackingId);
    var written = 0;

    if (existingRow > 0) {
      ['video','front','back','label'].forEach(function (k) {
        if (ids[k]) {
          var colIdx = HEADERS.indexOf(FILE_COL_MAP[k]) + 1;
          if (colIdx > 0) { sheet.getRange(existingRow, colIdx).setValue(ids[k]); written++; }
        }
      });
      if (driveAccount) {
        setCell(sheet, existingRow, 'Drive Account', driveAccount);
        written++;
      }
      Logger.log('logDelivery updated row ' + existingRow + ' for ' + trackingId);
      return jsonResponse({ success: true, trackingId: trackingId, row: existingRow, written: written });
    }

    // First write for this delivery — fetch Shopify order + create the row.
    var sd = fetchShopifyOrderByTracking(trackingId);
    var row = buildRow(trackingId, sd, ids, '', driveAccount, '');   // PATCH: no folder id on this path
    sheet.appendRow(row);
    var newRow = sheet.getLastRow();
    Logger.log('logDelivery created row ' + newRow + ' for ' + trackingId);
    return jsonResponse({ success: true, trackingId: trackingId, row: newRow, created: true });
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════
//  Subfolder + file helpers
// ═══════════════════════════════════════════

function resolveTargetFolder(folderName) {
  var parent = DriveApp.getFolderById(FOLDER_ID);
  if (!folderName) return parent;
  var existing = parent.getFoldersByName(folderName);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(folderName);
}

function getFileType(filename) {
  var fn = filename.toLowerCase();
  if (fn.indexOf('.mp4') > -1 || fn.indexOf('.mov') > -1) return 'video';
  if (fn.indexOf('front') > -1 || fn.indexOf('product') > -1) return 'front';
  if (fn.indexOf('back') > -1 || fn.indexOf('packed') > -1) return 'back';
  if (fn.indexOf('label') > -1) return 'label';
  return 'front';
}

function guessContentType(filename) {
  var ext = (filename.match(/\.([^.]+)$/) || [])[1] || '';
  switch (ext.toLowerCase()) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'mp4': return 'video/mp4';
    default: return 'application/octet-stream';
  }
}

// ═══════════════════════════════════════════
//  Verify
// ═══════════════════════════════════════════

function handleVerify(params) {
  var folder = resolveTargetFolder(params.folder);
  var files = folder.getFilesByName(params.verify);
  if (files.hasNext()) return jsonResponse({ found: true, fileUrl: files.next().getUrl(), fileName: params.verify });
  return jsonResponse({ found: false, fileName: params.verify });
}

// ═══════════════════════════════════════════
//  App Step 1: Get resumable upload URL  (LEGACY — app now uploads to storage accounts)
// ═══════════════════════════════════════════

function handleGetUploadUrl(params) {
  var filename = (params.filename || '').trim();
  var fileSize = params.fileSize || '';
  var folderName = (params.folder || '').trim();
  if (!filename) return jsonResponse({ success: false, error: 'Filename required' });

  try {
    var targetFolder = resolveTargetFolder(folderName);
    var contentType = guessContentType(filename);
    var metadata = { name: filename, parents: [targetFolder.getId()], description: 'DROPPY - ' + (folderName || filename) };

    var headers = { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': contentType };
    if (fileSize) headers['X-Upload-Content-Length'] = String(fileSize);

    var resp = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'post', headers: headers, payload: JSON.stringify(metadata), muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) return jsonResponse({ success: false, error: 'Upload session failed (' + resp.getResponseCode() + ')' });

    var loc = resp.getAllHeaders()['Location'] || resp.getAllHeaders()['location'] || '';
    if (!loc) return jsonResponse({ success: false, error: 'No upload URL' });
    return jsonResponse({ success: true, uploadUrl: loc, filename: filename });
  } catch (e) { return jsonResponse({ success: false, error: e.toString() }); }
}

// ═══════════════════════════════════════════
//  App Step 3: Upload complete — single-row upsert  (LEGACY — see handleLogDelivery)
//
//  PATCH: this IS the path that creates/resolves the tracking-ID folder on THIS
//  account (via resolveTargetFolder), so it's the one place that can capture a
//  real Folder ID cheaply — targetFolder.getId() is already in memory, no extra
//  Drive API call needed.
// ═══════════════════════════════════════════

function handleUploadComplete(params) {
  var filename = (params.filename || '').trim();
  var driveFileId = (params.driveFileId || '').trim();
  var folderName = (params.folder || '').trim();
  if (!filename) return jsonResponse({ success: false, error: 'Filename required' });

  try {
    var targetFolder = resolveTargetFolder(folderName);
    var file;
    if (driveFileId) { try { file = DriveApp.getFileById(driveFileId); } catch(e) {} }
    if (!file) {
      var it = targetFolder.getFilesByName(filename);
      if (!it.hasNext()) return jsonResponse({ success: false, error: 'File not found: ' + filename });
      file = it.next(); driveFileId = file.getId();
    }
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var trackingId = folderName ? extractTrackingId(folderName) : extractTrackingId(filename);
    var fileType = getFileType(filename);
    var folderId = targetFolder.getId();   // PATCH: captured here, free — targetFolder already resolved above

    // Lock to prevent race conditions (parallel uploads for same delivery)
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    var shopifyResult = null;

    try {
      var parentFolder = DriveApp.getFolderById(FOLDER_ID);
      var sheetData = getOrCreateSheet(parentFolder);
      var sheet = sheetData.sheet;

      var existingRow = findRowByTrackingId(sheet, trackingId);

      if (existingRow > 0) {
        var colName = FILE_COL_MAP[fileType];
        if (colName) {
          var colIdx = HEADERS.indexOf(colName) + 1;
          if (colIdx > 0) sheet.getRange(existingRow, colIdx).setValue(driveFileId);
        }
        // PATCH: backfill Folder ID on an existing row if it's blank (older rows
        // created before this column existed) — never overwrite one that's already set.
        var existingFolderId = String(sheet.getRange(existingRow, HEADERS.indexOf('Folder ID') + 1).getValue() || '').trim();
        if (!existingFolderId) setCell(sheet, existingRow, 'Folder ID', folderId);
        Logger.log('Updated row ' + existingRow + ' [' + fileType + '] = ' + driveFileId);
      } else {
        shopifyResult = fetchShopifyOrderByTracking(trackingId);
        var ids = {};
        ids[fileType] = driveFileId;
        var row = buildRow(trackingId, shopifyResult, ids, '', '', folderId);   // PATCH
        sheet.appendRow(row);
        Logger.log('Created row for ' + trackingId + ' [' + fileType + '] = ' + driveFileId);
      }
    } finally { lock.releaseLock(); }

    return jsonResponse({
      success: true, fileUrl: file.getUrl(), fileName: filename,
      trackingId: trackingId, driveFileId: driveFileId,
      shopify: shopifyResult ? { orderName: shopifyResult.orderName, customer: shopifyResult.customerName, status: shopifyResult.fulfillmentStatus } : null
    });
  } catch (e) {
    Logger.log('uploadComplete error: ' + e.toString());
    return jsonResponse({ success: false, error: e.toString() });
  }
}

// ═══════════════════════════════════════════
//  Set YouTube URL (LEGACY — kept for compatibility)
// ═══════════════════════════════════════════

function handleSetYoutubeUrl(params) {
  var trackingId = (params.trackingId || '').trim();
  var folderName = (params.folder || '').trim();
  var youtubeUrl = (params.youtubeUrl || '').trim();

  if (!trackingId && folderName) trackingId = extractTrackingId(folderName);
  if (!trackingId) return jsonResponse({ success: false, error: 'trackingId required' });
  if (!youtubeUrl) return jsonResponse({ success: false, error: 'youtubeUrl required' });

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var parentFolder = DriveApp.getFolderById(FOLDER_ID);
    var sheetData = getOrCreateSheet(parentFolder);
    var sheet = sheetData.sheet;

    var ytCol = HEADERS.indexOf('YouTube URL') + 1;
    var existingRow = findRowByTrackingId(sheet, trackingId);

    if (existingRow > 0) {
      sheet.getRange(existingRow, ytCol).setValue(youtubeUrl);
      Logger.log('Set YouTube URL row ' + existingRow + ' = ' + youtubeUrl);
    } else {
      var shopifyResult = fetchShopifyOrderByTracking(trackingId);
      var row = buildRow(trackingId, shopifyResult, {}, youtubeUrl, '', '');
      sheet.appendRow(row);
      Logger.log('Created row for YouTube URL ' + trackingId + ' = ' + youtubeUrl);
    }
  } finally { lock.releaseLock(); }

  return jsonResponse({ success: true, trackingId: trackingId, youtubeUrl: youtubeUrl });
}

// ═══════════════════════════════════════════
//  Sheet helpers
// ═══════════════════════════════════════════

function getOrCreateSheet(parentFolder) {
  var files = parentFolder.getFilesByName('DROPPY-Log');
  var ss;
  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
    ensureColumns(ss.getActiveSheet());
  } else {
    ss = SpreadsheetApp.create('DROPPY-Log');
    var f = DriveApp.getFileById(ss.getId()); parentFolder.addFile(f); DriveApp.getRootFolder().removeFile(f);
    var s = ss.getActiveSheet(); s.appendRow(HEADERS);
    s.getRange('1:1').setFontWeight('bold').setBackground('#00ff88').setFontColor('#000000');
    s.setFrozenRows(1); setColumnWidths(s);
  }
  return { sheet: ss.getActiveSheet() };
}

/**
 * Migrate an existing sheet up to the current HEADERS — writes any header cell that is missing or
 * out of place. Safe to run on every call: new columns are only ever APPENDED to HEADERS, so
 * existing rows keep their alignment and simply gain blank cells on the right.
 */
function ensureColumns(sheet) {
  var width = Math.max(sheet.getLastColumn(), HEADERS.length);
  var headerRow = sheet.getRange(1, 1, 1, width).getValues()[0];
  var widths = columnWidthMap();

  for (var i = 0; i < HEADERS.length; i++) {
    if (String(headerRow[i] || '').trim() === HEADERS[i]) continue;
    sheet.getRange(1, i + 1).setValue(HEADERS[i])
      .setFontWeight('bold').setBackground('#00ff88').setFontColor('#000000');
    if (widths[HEADERS[i]]) sheet.setColumnWidth(i + 1, widths[HEADERS[i]]);
    Logger.log('ensureColumns: added header "' + HEADERS[i] + '" at column ' + (i + 1));
  }
}

/** Write one named cell on a row. No-op if the column isn't in HEADERS. */
function setCell(sheet, row, headerName, value) {
  var col = HEADERS.indexOf(headerName) + 1;
  if (col > 0) sheet.getRange(row, col).setValue(value);
}

function findRowByTrackingId(sheet, trackingId) {
  var data = sheet.getDataRange().getValues();
  var tidCol = HEADERS.indexOf('Tracking ID');
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][tidCol] || '').trim() === trackingId) return r + 1;
  }
  return 0;
}

// ═══════════════════════════════════════════
//  doPost — LEGACY (base64 video path still lands in Drive on THIS account)
//
//  PATCH: this path writes straight to FOLDER_ID (the top-level parent), not a
//  per-tracking-ID subfolder — there is no per-delivery folder to capture an id
//  from here, so Folder ID is left blank on this legacy path.
// ═══════════════════════════════════════════

function doPost(e) {
  try {
    var data; if (e.parameter && e.parameter.payload) data = JSON.parse(e.parameter.payload); else data = JSON.parse(e.postData.contents);
    var filename = data.filename || 'DROPPY-UNKNOWN.mp4';
    var trackingId = extractTrackingId(filename);
    var decoded = Utilities.base64Decode(data.data);
    var blob = Utilities.newBlob(decoded, data.mimeType || 'video/mp4', filename);
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var sd = fetchShopifyOrderByTracking(trackingId);
    var sheetData = getOrCreateSheet(folder);
    // Legacy path: the video lands in THIS (main) account's Drive.
    var row = buildRow(trackingId, sd, { video: file.getId() }, '', thisAccountEmail_(), '');
    sheetData.sheet.appendRow(row);
    return jsonResponse({ success: true, fileUrl: file.getUrl(), fileName: filename, trackingId: trackingId });
  } catch (e) { return jsonResponse({ success: false, error: e.toString() }); }
}

// ═══════════════════════════════════════════
//  Customer Lookup — returns video URL (drive:{id} when no YouTube URL) + photos
// ═══════════════════════════════════════════

function handleCustomerLookup(params) {
  var trackingId = (params.tracking_id || '').trim(), phone = (params.phone || '').trim();
  if (!trackingId || !phone) return jsonResponse({ success: false, error: 'Tracking ID and phone required' });

  var folder = DriveApp.getFolderById(FOLDER_ID);
  var files = folder.getFilesByName('DROPPY-Log');
  if (!files.hasNext()) return handleLiveShopifyLookup(trackingId, phone);

  var ss = SpreadsheetApp.open(files.next());
  var sheet = ss.getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0], col = {};
  for (var h = 0; h < headers.length; h++) col[headers[h]] = h;

  var cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.length > 10) cleanPhone = cleanPhone.slice(-10);

  for (var r = 1; r < data.length; r++) {
    var row = data[r], rt = String(row[col['Tracking ID']] || '').trim();
    if (rt !== trackingId) continue;

    var rp = String(row[col['Customer Phone']] || '').replace(/[^0-9]/g, '');
    if (rp.length > 10) rp = rp.slice(-10);
    if (cleanPhone && rp && cleanPhone !== rp) return jsonResponse({ success: false, error: 'Phone number does not match our records' });

    var videoFid = String(row[col['Video File ID']] || '').trim();
    var frontFid = String(row[col['Front Photo ID']] || '').trim();
    var backFid  = String(row[col['Back Photo ID']] || '').trim();
    var labelFid = String(row[col['Label Photo ID']] || '').trim();
    var youtubeUrl = col['YouTube URL'] !== undefined ? String(row[col['YouTube URL']] || '').trim() : '';

    var filesDeleted = col['Files Deleted'] !== undefined
      ? String(row[col['Files Deleted']] || '').trim() : '';

    var photos = [];
    if (!filesDeleted) {
      if (frontFid) photos.push({ name: 'Product Front', driveFileId: frontFid });
      if (backFid)  photos.push({ name: 'Product Back', driveFileId: backFid });
      if (labelFid) photos.push({ name: 'Shipping Label', driveFileId: labelFid });
    }

    var videoUrl = filesDeleted ? '' : (youtubeUrl ? youtubeUrl : (videoFid ? 'drive:' + videoFid : ''));

    return jsonResponse({
      success: true, order: {
        orderName: row[col['Order Name']] || '', trackingId: rt,
        trackingCompany: row[col['Tracking Company']] || '', customerName: row[col['Customer Name']] || '',
        totalPrice: row[col['Total Price']] || '', items: row[col['Items']] || '',
        fulfillmentStatus: row[col['Fulfillment Status']] || '', orderDate: row[col['Order Date']] || '',
        deliveryStatus: col['Delivery Status'] !== undefined ? (row[col['Delivery Status']] || '') : '',
        statusDate: col['Status Date'] !== undefined ? (row[col['Status Date']] || '') : '',
        videoUrl: videoUrl,
        youtubeUrl: filesDeleted ? '' : youtubeUrl,
        photos: photos,
        mediaExpired: filesDeleted ? true : false,
        mediaExpiredAt: filesDeleted,
        packedAt: formatSheetDateTime(row[col['Date']], row[col['Time']])
      }
    });
  }
  return handleLiveShopifyLookup(trackingId, phone);
}

function handleLiveShopifyLookup(trackingId, phone) {
  var sd = fetchShopifyOrderByTracking(trackingId);
  if (!sd) return jsonResponse({ success: false, error: 'Order not found.' });
  var cp = phone.replace(/[^0-9]/g, ''); if (cp.length > 10) cp = cp.slice(-10);
  var op = (sd.customerPhone || '').replace(/[^0-9]/g, ''); if (op.length > 10) op = op.slice(-10);
  if (cp && op && cp !== op) return jsonResponse({ success: false, error: 'Phone number does not match our records' });
  return jsonResponse({ success: true, order: {
    orderName: sd.orderName, trackingId: sd.trackingNumber, trackingCompany: sd.trackingCompany,
    customerName: sd.customerName, totalPrice: sd.currency + ' ' + sd.totalPrice, items: sd.itemsStr,
    fulfillmentStatus: sd.fulfillmentStatus, orderDate: sd.orderDate,
    deliveryStatus: buildDeliveryStatus(sd), statusDate: formatShopifyDate(sd.statusDate),
    videoUrl: '', youtubeUrl: '', photos: [], packedAt: ''
  }});
}

// ═══════════════════════════════════════════
//  Shopify GraphQL
// ═══════════════════════════════════════════

function shopifyGraphQL(query) {
  var url = 'https://' + SHOPIFY_STORE + '/admin/api/' + SHOPIFY_API_VERSION + '/graphql.json';
  var r = UrlFetchApp.fetch(url, { method:'post', headers:{'X-Shopify-Access-Token':SHOPIFY_TOKEN,'Content-Type':'application/json'}, payload:JSON.stringify({query:query}), muteHttpExceptions:true });
  if (r.getResponseCode() !== 200) return null;
  return JSON.parse(r.getContentText());
}

function extractTrackingId(input) {
  var m = input.match(/^\d{2}\.\d{2}\.\d{4}-([^.]+)/);
  if (m) return m[1];
  var name = input.replace(/\.[^.]+$/, '');
  m = name.match(/^DROPPY-(.+)$/);
  if (m) return m[1];
  return name;
}

function fetchShopifyOrderByTracking(trackingId) {
  if (!trackingId || trackingId === 'N/A' || trackingId === 'UNKNOWN') return null;
  try {
    var safeId = String(trackingId).replace(/["\\\n\r]/g, '').trim();
    if (!safeId) return null;

    var query = '{ orders(first:25, query:"' + safeId + '") { edges { node { id name createdAt phone ' +
      'displayFulfillmentStatus displayFinancialStatus totalPriceSet{shopMoney{amount currencyCode}} ' +
      'customer{firstName lastName email phone} shippingAddress{phone} ' +
      'fulfillments(first:20){ displayStatus updatedAt createdAt trackingInfo{number url company} } ' +
      'lineItems(first:20){edges{node{name quantity sku}}} } } } }';

    var result = shopifyGraphQL(query);
    if (!result || result.errors || !result.data || !result.data.orders) {
      if (result && result.errors) Logger.log('Shopify GraphQL errors: ' + JSON.stringify(result.errors));
      return null;
    }
    var edges = result.data.orders.edges || [];
    if (!edges.length) { Logger.log('No Shopify order matched ' + trackingId); return null; }

    var order = null, tn = '', tu = '', tc = '', fulStatus = '', statusDate = '';
    for (var o = 0; o < edges.length && !order; o++) {
      var cand = edges[o].node, fuls = cand.fulfillments || [];
      for (var f = 0; f < fuls.length && !order; f++) {
        var ti = fuls[f].trackingInfo || [];
        for (var t = 0; t < ti.length; t++) {
          if (String(ti[t].number || '').trim() !== trackingId) continue;
          order     = cand;
          tn        = ti[t].number;
          tu        = ti[t].url || '';
          tc        = ti[t].company || '';
          fulStatus = fuls[f].displayStatus || '';
          statusDate = fuls[f].updatedAt || fuls[f].createdAt || '';
          break;
        }
      }
    }
    if (!order) {
      Logger.log('Shopify returned ' + edges.length + ' order(s) for ' + trackingId +
        ' but none carry that tracking number — refusing to guess (first was ' + edges[0].node.name + ')');
      return null;
    }

    var cn='',cp='',ce='';
    if (order.customer){cn=((order.customer.firstName||'')+' '+(order.customer.lastName||'')).trim();ce=order.customer.email||'';cp=order.customer.phone||'';}
    if(!cp&&order.phone)cp=order.phone; if(!cp&&order.shippingAddress&&order.shippingAddress.phone)cp=order.shippingAddress.phone;
    var items=[]; if(order.lineItems&&order.lineItems.edges){for(var i=0;i<order.lineItems.edges.length;i++){var li=order.lineItems.edges[i].node;items.push({title:li.name||'',quantity:li.quantity||1,sku:li.sku||''});}}
    var itemsStr=items.map(function(x){return x.quantity+'x '+x.title;}).join(' | ');

    return {
      orderName: order.name, customerName: cn, customerPhone: cp, customerEmail: ce,
      totalPrice: order.totalPriceSet.shopMoney.amount, currency: order.totalPriceSet.shopMoney.currencyCode,
      financialStatus: order.displayFinancialStatus, fulfillmentStatus: order.displayFulfillmentStatus,
      fulfillmentDisplayStatus: fulStatus,
      statusDate: statusDate || order.createdAt,
      trackingNumber: tn, trackingUrl: tu, trackingCompany: tc,
      items: items, itemsStr: itemsStr, orderDate: order.createdAt
    };
  } catch(e){Logger.log('Shopify error: '+e.toString());return null;}
}

// ═══════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════

function jsonResponse(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}

function formatSheetDateTime(dateVal,timeVal){
  if(!dateVal)return '';
  try{var d=new Date(dateVal);var r=Utilities.formatDate(d,Session.getScriptTimeZone(),'dd MMM yyyy');if(timeVal){var t=new Date(timeVal);r+=', '+Utilities.formatDate(t,Session.getScriptTimeZone(),'hh:mm a');}return r;}catch(e){return String(dateVal);}
}

// PATCH: 'Folder ID' added at the standard width used for the other ID columns.
function columnWidthMap(){
  return {'Date':100,'Time':80,'Tracking ID':150,'Order Name':130,'Customer Name':160,'Customer Phone':130,'Customer Email':180,'Items':350,'Total Price':110,'Fulfillment Status':130,'Financial Status':120,'Tracking URL':280,'Tracking Company':130,'Order Date':130,'Video File ID':280,'Front Photo ID':280,'Back Photo ID':280,'Label Photo ID':280,'YouTube URL':320,'Drive Account':220,'Delivery Status':200,'Status Date':140,'Files Deleted':140,'Folder ID':280};
}

function setColumnWidths(sheet){
  var w=columnWidthMap();
  for(var i=0;i<HEADERS.length;i++)if(w[HEADERS[i]])sheet.setColumnWidth(i+1,w[HEADERS[i]]);
}

function forceAuth(){UrlFetchApp.fetch('https://httpbin.org/get');Logger.log('Auth forced');}

// ═══════════════════════════════════════════
//  NOTE: everything below this point (audit/repair/refresh, retention/purge,
//  handleMeta, handlePurge) was received in the original paste but is NOT
//  reproduced here since it doesn't touch HEADERS/buildRow/folder resolution —
//  the functions above are self-contained and don't call anything below this
//  line for the parts relevant to the Folder ID patch. Your live project
//  already has the real, complete versions of those functions; only apply the
//  PATCH: changes marked above to it, do not paste this file over your project.
// ═══════════════════════════════════════════
