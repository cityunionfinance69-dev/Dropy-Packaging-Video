  // ═══════════════════════════════════════════
  //  DASHBOARD — dashboardData: paginated read-only feed of DROPPY-Log
  //
  //  Add this file to your existing Apps Script project (same project as Code.gs).
  //  Then add ONE line to your route_() switch statement — shown at the bottom of
  //  this file — to wire it in. Nothing else in your existing code changes.
  //
  //    ?action=dashboardData&key={ADMIN_KEY}&offset=0&limit=200
  //
  //  Why paginated: your sheet grows every day. A dashboard that pulls the whole
  //  sheet on every page load will get slower every week and eventually hit the
  //  6-minute execution limit or a huge response payload. Offset/limit means the
  //  frontend can lazy-load: show the first 200 rows instantly, fetch more on
  //  scroll. Same trick your scanRows_() already uses for a different reason
  //  (avoiding the execution-time limit) — here it's about response size instead.
  //
  //  Why re-use ADMIN_KEY instead of a new secret: one fewer credential to
  //  rotate and lose track of. If you'd rather the dashboard have read-only
  //  access without the power to trigger repair/purge jobs, say so and we'll
  //  split it into a DASHBOARD_KEY — five-minute change.
  // ═══════════════════════════════════════════

  // Sheets silently upgrades date/time-LOOKING strings into real Date objects on
  // write, regardless of what type you handed it — your own formatSheetDateTime()
  // and cellToTime_() already work around this elsewhere in Code.gs. This is the
  // same fix, scoped to a single cell instead of a combined date+time pair.
  function formatCell_(value) {
    if (value instanceof Date) {
      // A "time-only" cell lands on Sheets' epoch date (Dec 30 1899) — detect that
      // and format as time-only; otherwise format as a plain date.
      var isTimeOnly = value.getFullYear() === 1899 && value.getMonth() === 11 && value.getDate() === 30;
      return Utilities.formatDate(value, Session.getScriptTimeZone(), isTimeOnly ? 'HH:mm:ss' : 'yyyy-MM-dd');
    }
    return String(value || '');
  }

  function handleDashboardData(params) {
    if (String(params.key || '') !== ADMIN_KEY) {
      Utilities.sleep(1000);
      return jsonResponse({ success: false, error: 'unauthorized' });
    }

    var offset = parseInt(params.offset || '0', 10);
    if (!(offset >= 0)) offset = 0;
    var limit = parseInt(params.limit || '200', 10);
    if (!(limit > 0) || limit > 500) limit = 200;   // hard cap — protects the Apps Script quota

    var sheet = getOrCreateSheet(DriveApp.getFolderById(FOLDER_ID)).sheet;

    // PERF: sheet.getDataRange().getValues() used to read the ENTIRE sheet on
    // every call — with 1800+ rows that's what was making /api/deliveries take
    // several seconds even for a 200-row page. lastRow alone is cheap (no cell
    // read), so use it to compute exactly which rows this page needs and pull
    // ONLY that slice with getRange(...).getValues() — one small read instead
    // of the whole sheet, and cost stops growing as the sheet grows.
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var totalRows = lastRow - 1;   // minus header

    var col = {};
    for (var h = 0; h < HEADERS.length; h++) col[HEADERS[h]] = h;

    // Newest first — a delivery ops dashboard is almost always "what happened recently",
    // and reversing here means the frontend never has to think about sort order.
    var startRow = Math.max(2, lastRow - offset - limit + 1);   // 1-based, header is row 1
    var endRow = lastRow - offset;                              // inclusive, 1-based

    var rows = [];
    if (endRow >= startRow) {
      var slice = sheet.getRange(startRow, 1, endRow - startRow + 1, lastCol).getValues();
      for (var r = slice.length - 1; r >= 0; r--) {
        var v = slice[r];
        var get = function (h) { return v[col[h]]; };
        var filesDeleted = String(get('Files Deleted') || '').trim();

        rows.push({
          trackingId:      String(get('Tracking ID') || ''),
          orderName:       String(get('Order Name') || ''),
          customerName:    String(get('Customer Name') || ''),
          items:           String(get('Items') || ''),
          totalPrice:      String(get('Total Price') || ''),
          deliveryStatus:  String(get('Delivery Status') || ''),
          statusDate:      String(get('Status Date') || ''),
          driveAccount:    String(get('Drive Account') || ''),
          videoFileId:     String(get('Video File ID') || ''),
          frontPhotoId:    String(get('Front Photo ID') || ''),
          backPhotoId:     String(get('Back Photo ID') || ''),
          labelPhotoId:    String(get('Label Photo ID') || ''),
          youtubeUrl:      String(get('YouTube URL') || ''),
          createdDate:     formatCell_(get('Date')),
          createdTime:     formatCell_(get('Time')),
          filesDeleted:    filesDeleted,               // '' = still live, non-empty = purged (with stamp)
          // Blank on rows written before the Folder ID column existed, and on rows
          // written via logDelivery/doPost, which never resolve a per-tracking-ID
          // subfolder — see the PATCH notes in Code.gs's handleUploadComplete.
          folderId:        String(get('Folder ID') || ''),
          hasMedia:        !filesDeleted && !!(get('Video File ID') || get('Front Photo ID'))
        });
      }
    }

    return jsonResponse({
      success: true,
      totalRows: totalRows,
      offset: offset,
      limit: limit,
      hasMore: startRow > 2,
      rows: rows
    });
  }

  // ── Wire-in: inside your existing route_(e) switch statement, add this case
  //    alongside 'admin', 'meta', etc:
  //
  //      case 'dashboardData': return handleDashboardData(e.parameter);
