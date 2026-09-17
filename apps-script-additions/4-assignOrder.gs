// ═══════════════════════════════════════════════════════════════════════════
//  assignOrder — attach an order to a delivery row that Shopify never matched.
//
//  WHY: ~31 rows in the live sheet have media, a tracking ID and a Drive
//  account, but a blank Order Name / Customer / Items / Status — Shopify
//  returned no verified match for that tracking ID, so nothing was ever
//  written. Until now nothing in the system could fix that: every Order Name
//  write happens inside the Shopify lookup path, and there was no way to say
//  "this parcel is order #Dropy-1642-1-1".
//
//  WHAT IT DOES: given a tracking ID and an order name, it looks the order up
//  in Shopify by NAME and writes the real order data into the row — the same
//  columns the automatic path fills (SHOPIFY_COLS). It does not invent data:
//  if Shopify doesn't know the order name, nothing is written and the endpoint
//  says so.
//
//  Media columns, Drive Account, Date, Time and Folder ID are never touched —
//  same rule repairDeliveryRows() follows.
//
//  ── INSTALL ───────────────────────────────────────────────────────────────
//  1. Add this file to the MAIN script project (with DROPPY-Log / ADMIN_KEY).
//  2. In that project's route_(e) switch, add:
//
//         case 'assignOrder': return handleAssignOrder(e.parameter);
//
//  3. Re-deploy: Deploy → Manage deployments → Edit → New version → Deploy.
// ═══════════════════════════════════════════════════════════════════════════

function handleAssignOrder(params) {
  try {
    var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
    if (expected && String(params.key || '') !== String(expected)) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    var trackingId = String(params.trackingId || '').trim();
    var orderName = String(params.orderName || '').trim();
    if (!trackingId) return jsonResponse({ success: false, error: 'trackingId required' });
    if (!orderName) return jsonResponse({ success: false, error: 'orderName required' });

    // Accept "1642", "Dropy-1642", "#Dropy-1642-1-1" — normalise to the "#..."
    // form Shopify stores, so the operator doesn't have to type it exactly.
    if (orderName.charAt(0) !== '#') orderName = '#' + orderName;

    var sheet = SpreadsheetApp.openById(SHEET_ID_FOR_STATS_()).getSheetByName(SHEET_NAME_FOR_STATS_());
    if (!sheet) return jsonResponse({ success: false, error: 'Log sheet not found' });

    var rowIndex = findRowByTrackingId(sheet, trackingId);
    if (!rowIndex) {
      return jsonResponse({ success: false, error: 'No row found for tracking ID ' + trackingId });
    }

    // Look the order up by name. Only a real Shopify order gets written — this
    // endpoint attaches an EXISTING order to a row, it never fabricates one.
    var order = fetchShopifyOrderByName_(orderName);
    if (!order) {
      return jsonResponse({
        success: false,
        error: 'Shopify has no order named ' + orderName + ' — check the order number.'
      });
    }

    // Guard against silently re-pointing a row that already has an order. The
    // caller must pass force=true to overwrite, so a typo can't quietly
    // rewrite a correct row.
    var existing = String(getCell_(sheet, rowIndex, 'Order Name') || '').trim();
    if (existing && existing !== order.name && String(params.force || '') !== 'true') {
      return jsonResponse({
        success: false,
        error: 'Row already assigned to ' + existing + '. Re-send with force=true to replace it.'
      });
    }

    var written = writeOrderToRow_(sheet, rowIndex, order);

    return jsonResponse({
      success: true,
      trackingId: trackingId,
      row: rowIndex,
      orderName: order.name,
      customerName: order.customerName,
      written: written
    });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

/** Read one cell by header name, using the same HEADERS index setCell writes by. */
function getCell_(sheet, rowIndex, headerName) {
  var col = HEADERS.indexOf(headerName) + 1;
  return col > 0 ? sheet.getRange(rowIndex, col).getValue() : '';
}

/**
 * Write the Shopify-sourced columns for this order into the row.
 * Mirrors the automatic path's column set; media/Drive/date columns untouched.
 */
function writeOrderToRow_(sheet, rowIndex, order) {
  var values = {
    'Order Name': order.name,
    'Customer Name': order.customerName,
    'Customer Phone': order.customerPhone,
    'Customer Email': order.customerEmail,
    'Items': order.items,
    'Total Price': order.totalPrice,
    'Fulfillment Status': order.fulfillmentStatus,
    'Financial Status': order.financialStatus,
    'Tracking URL': order.trackingUrl,
    'Tracking Company': order.trackingCompany,
    'Order Date': order.orderDate,
    'Delivery Status': order.deliveryStatus,
    'Status Date': order.statusDate
  };

  var written = [];
  for (var header in values) {
    var v = values[header];
    if (v === undefined || v === null || v === '') continue;
    setCell(sheet, rowIndex, header, v);
    written.push(header);
  }
  return written;
}

/**
 * Fetch one order by its NAME (e.g. "#Dropy-1642-1-1").
 *
 * The existing fetchShopifyOrderByTracking() searches by tracking number,
 * which is exactly what failed for these rows — so this queries by name
 * instead, reusing the same shopifyGraphQL() transport and the same
 * buildDeliveryStatus()/titleCase() shaping the automatic path uses, so an
 * assigned row is indistinguishable from an automatically matched one.
 */
function fetchShopifyOrderByName_(orderName) {
  var escaped = String(orderName).replace(/"/g, '\\"');
  var query =
    '{ orders(first: 1, query: "name:\\"' + escaped + '\\"") { edges { node { ' +
    'name createdAt displayFulfillmentStatus displayFinancialStatus ' +
    'currentTotalPriceSet { shopMoney { amount currencyCode } } ' +
    'customer { firstName lastName phone email } ' +
    'lineItems(first: 50) { edges { node { quantity title } } } ' +
    'fulfillments(first: 5) { trackingInfo { number url company } displayStatus } ' +
    '} } } }';

  var res = shopifyGraphQL(query);
  var edges = res && res.data && res.data.orders && res.data.orders.edges;
  if (!edges || edges.length === 0) return null;

  var o = edges[0].node;

  // Shopify's name: filter is a prefix-ish search, so confirm the returned
  // order is actually the one asked for rather than a near neighbour.
  if (String(o.name).trim().toLowerCase() !== String(orderName).trim().toLowerCase()) return null;

  var c = o.customer || {};
  var items = (o.lineItems && o.lineItems.edges ? o.lineItems.edges : [])
    .map(function (e) { return e.node.quantity + 'x ' + e.node.title; })
    .join(' | ');

  var money = o.currentTotalPriceSet && o.currentTotalPriceSet.shopMoney;
  var totalPrice = money ? money.currencyCode + ' ' + money.amount : '';

  var f = (o.fulfillments && o.fulfillments.length) ? o.fulfillments[0] : null;
  var ti = (f && f.trackingInfo && f.trackingInfo.length) ? f.trackingInfo[0] : {};

  var sd = {
    fulfillmentStatus: o.displayFulfillmentStatus,
    financialStatus: o.displayFinancialStatus,
    fulfillmentDisplayStatus: f ? f.displayStatus : ''
  };

  return {
    name: o.name,
    customerName: [c.firstName, c.lastName].filter(String).join(' ').trim(),
    customerPhone: c.phone || '',
    customerEmail: c.email || '',
    items: items,
    totalPrice: totalPrice,
    fulfillmentStatus: titleCase(String(o.displayFulfillmentStatus || '')),
    financialStatus: titleCase(String(o.displayFinancialStatus || '')),
    trackingUrl: ti.url || '',
    trackingCompany: ti.company || '',
    orderDate: formatShopifyDate(o.createdAt),
    deliveryStatus: buildDeliveryStatus(sd),
    statusDate: new Date().toString()
  };
}
