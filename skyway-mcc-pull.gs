/**
 * Skyway Media — Google Ads MCC Comprehensive Data Pull
 * -----------------------------------------------------
 * READ-ONLY. Iterates every account under the MCC and pulls everything
 * Skyway OS needs into a multi-tab Google Sheet:
 *
 *   • Accounts        — one row per account; 7d / 30d / 90d totals;
 *                       optimization score, currency, time zone, status.
 *   • Campaigns       — one row per campaign; status, budget, bid strategy,
 *                       30d performance (spend / clicks / conv / CPA).
 *   • Search Terms    — one row per search term that got a click in 30d;
 *                       spend, clicks, conv. *This is where waste hides.*
 *   • Conversion      — one row per configured conversion action per
 *     Actions           account; type, category, status, value settings.
 *                       Lets us see which accounts have proper tracking
 *                       set up at all.
 *   • Tracking Config — account- and campaign-level Final URL suffix
 *                       and tracking templates; powers the Skyway OS
 *                       Tracking Health badge on accounts.html.
 *   • Errors          — anything that failed. Useful for debugging.
 *
 * Replaces Supermetrics for the Google side entirely. Free. Auth uses the
 * MCC's own credentials — no token to manage.
 *
 * Where to install:
 *   Google Ads MCC (analytics@skyway.media)
 *   → Tools & settings → Bulk actions → Scripts → New script
 *   → Paste this entire file → Authorize → Run
 *
 * Output:
 *   Google Sheet titled "Skyway — Google Ads MCC Data Pull" in the script
 *   owner's Drive. Re-running refreshes every tab in place.
 *
 * Re-run cadence:
 *   First run: manual, ~5–10 minutes for ~88 accounts.
 *   Then: schedule daily (Scripts → Frequency → Daily) — runs unattended.
 *
 * After it runs:
 *   Share the Sheet with emily@skyway.media (read access). Send Aaron the
 *   Sheet URL. Skyway OS ingests it into the per-account UI.
 *
 * Read-only guarantee:
 *   Every query in this file is a GAQL SELECT statement. Google's API
 *   rejects mutation attempts on SELECT queries at the server level. The
 *   file contains zero mutation calls — no .pause(), .enable(), .remove(),
 *   .setBudget(), .newCampaignBuilder(), nothing. Verify by reading the
 *   ~250 lines below or by grepping the file.
 */

var SHEET_NAME = 'Skyway — Google Ads MCC Data Pull';
var SEARCH_TERM_MIN_CLICKS = 1;   // only include search terms with >= this many clicks (cuts noise)

function main() {
  var startedAt = new Date();
  Logger.log('Skyway MCC pull started at ' + startedAt.toISOString());

  // Accumulators — one array per tab. We'll write everything at the end.
  var accountsRows       = [accountsHeader()];
  var campaignsRows      = [campaignsHeader()];
  var searchTermsRows    = [searchTermsHeader()];
  var conversionsRows    = [conversionsHeader()];
  var trackingRows       = [trackingHeader()];
  var errorRows          = [errorsHeader()];

  var summary = { accounts: 0, errors: 0, campaigns: 0, search_terms: 0, conversion_actions: 0 };

  var accountIter = AdsManagerApp.accounts().get();
  while (accountIter.hasNext()) {
    var account = accountIter.next();
    summary.accounts++;
    var customerId = account.getCustomerId().replace(/-/g, '');
    var accountName = account.getName() || '';

    try {
      AdsManagerApp.select(account);
      Logger.log('[' + customerId + '] ' + accountName);

      // === ACCOUNT OVERVIEW ===
      var acctRow = buildAccountRow(customerId, accountName);
      accountsRows.push(acctRow.row);

      // === CAMPAIGNS ===
      var campCount = pullCampaigns(customerId, accountName, campaignsRows, errorRows);
      summary.campaigns += campCount;

      // === SEARCH TERMS ===
      var stCount = pullSearchTerms(customerId, accountName, searchTermsRows, errorRows);
      summary.search_terms += stCount;

      // === CONVERSION ACTIONS ===
      var convCount = pullConversionActions(customerId, accountName, conversionsRows, errorRows);
      summary.conversion_actions += convCount;

      // === TRACKING CONFIG ===
      pullTracking(customerId, accountName, acctRow.acctSuffix, acctRow.acctTemplate, trackingRows, errorRows);

    } catch (e) {
      Logger.log('  account-level error: ' + e);
      summary.errors++;
      errorRows.push([customerId, accountName, 'account-level', String(e)]);
    }
  }

  // Write everything to the Sheet
  var ss = openOrCreateSheet();
  writeTab(ss, 'Accounts',           accountsRows);
  writeTab(ss, 'Campaigns',          campaignsRows);
  writeTab(ss, 'Search Terms',       searchTermsRows);
  writeTab(ss, 'Conversion Actions', conversionsRows);
  writeTab(ss, 'Tracking Config',    trackingRows);
  writeTab(ss, 'Errors',             errorRows);

  var elapsed = ((new Date()).getTime() - startedAt.getTime()) / 1000;
  Logger.log('---');
  Logger.log('Done in ' + elapsed.toFixed(1) + 's');
  Logger.log('Accounts:           ' + summary.accounts);
  Logger.log('Campaigns:          ' + summary.campaigns);
  Logger.log('Search terms:       ' + summary.search_terms);
  Logger.log('Conversion actions: ' + summary.conversion_actions);
  Logger.log('Errors:             ' + summary.errors);
  Logger.log('Sheet:              ' + ss.getUrl());
}

// ============================================================
//  ACCOUNT OVERVIEW
// ============================================================
function accountsHeader() {
  return [
    'Customer ID', 'Account Name', 'Currency', 'Time Zone',
    'Optimization Score', 'Status',
    'Spend 7d', 'Clicks 7d', 'Conv 7d', 'CPA 7d',
    'Spend 30d', 'Clicks 30d', 'Conv 30d', 'CPA 30d',
    'Spend 90d', 'Clicks 90d', 'Conv 90d', 'CPA 90d',
    'Account Final URL Suffix', 'Account Tracking Template', 'Account Has UTMs'
  ];
}

function buildAccountRow(customerId, accountName) {
  // Customer entity (single row)
  var currency = '', timeZone = '', optScore = '', status = '';
  var acctSuffix = '', acctTemplate = '';
  try {
    var rs = AdsApp.search(
      'SELECT customer.currency_code, customer.time_zone, customer.optimization_score, ' +
      '       customer.status, customer.final_url_suffix, customer.tracking_url_template ' +
      'FROM customer LIMIT 1'
    );
    while (rs.hasNext()) {
      var c = rs.next().customer || {};
      currency      = c.currencyCode || '';
      timeZone      = c.timeZone || '';
      optScore      = (c.optimizationScore != null) ? c.optimizationScore : '';
      status        = c.status || '';
      acctSuffix    = c.finalUrlSuffix || '';
      acctTemplate  = c.trackingUrlTemplate || '';
    }
  } catch (e) {
    Logger.log('  customer query failed: ' + e);
  }

  // Metrics for 7d / 30d / 90d (aggregate from campaigns)
  var m7  = aggregateAccountMetrics('LAST_7_DAYS');
  var m30 = aggregateAccountMetrics('LAST_30_DAYS');
  var m90 = aggregateAccountMetrics('LAST_90_DAYS');

  var hasUtms = hasRequiredUTMs(acctSuffix + ' ' + acctTemplate);

  return {
    row: [
      customerId, accountName, currency, timeZone, optScore, status,
      m7.cost.toFixed(2),  m7.clicks,  m7.conv.toFixed(2),  m7.cpa,
      m30.cost.toFixed(2), m30.clicks, m30.conv.toFixed(2), m30.cpa,
      m90.cost.toFixed(2), m90.clicks, m90.conv.toFixed(2), m90.cpa,
      acctSuffix, acctTemplate, hasUtms ? 'TRUE' : 'FALSE'
    ],
    acctSuffix: acctSuffix,
    acctTemplate: acctTemplate
  };
}

function aggregateAccountMetrics(dateRange) {
  var totals = { cost: 0, clicks: 0, conv: 0 };
  try {
    var rs = AdsApp.search(
      'SELECT metrics.cost_micros, metrics.clicks, metrics.conversions ' +
      'FROM customer DURING ' + dateRange
    );
    while (rs.hasNext()) {
      var m = rs.next().metrics || {};
      totals.cost   += (Number(m.costMicros || 0) / 1e6);
      totals.clicks += Number(m.clicks || 0);
      totals.conv   += Number(m.conversions || 0);
    }
  } catch (e) {
    Logger.log('  account metrics ' + dateRange + ' failed: ' + e);
  }
  totals.cpa = (totals.conv > 0) ? (totals.cost / totals.conv).toFixed(2) : '';
  return totals;
}

// ============================================================
//  CAMPAIGNS (30d window)
// ============================================================
function campaignsHeader() {
  return [
    'Customer ID', 'Account Name', 'Campaign ID', 'Campaign Name', 'Status',
    'Channel Type', 'Bidding Strategy', 'Budget (Daily)',
    'Impressions 30d', 'Clicks 30d', 'Cost 30d', 'Conv 30d',
    'Conv Value 30d', 'CTR 30d', 'Avg CPC 30d', 'CPA 30d'
  ];
}

function pullCampaigns(customerId, accountName, rows, errorRows) {
  var count = 0;
  try {
    var rs = AdsApp.search(
      'SELECT campaign.id, campaign.name, campaign.status, ' +
      '       campaign.advertising_channel_type, campaign.bidding_strategy_type, ' +
      '       campaign_budget.amount_micros, ' +
      '       metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
      '       metrics.conversions, metrics.conversions_value, ' +
      '       metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion ' +
      'FROM campaign ' +
      'WHERE campaign.status != "REMOVED" ' +
      'DURING LAST_30_DAYS'
    );
    while (rs.hasNext()) {
      var r = rs.next();
      var c = r.campaign || {};
      var b = r.campaignBudget || {};
      var m = r.metrics || {};
      rows.push([
        customerId, accountName,
        String(c.id || ''), c.name || '', c.status || '',
        c.advertisingChannelType || '', c.biddingStrategyType || '',
        (Number(b.amountMicros || 0) / 1e6).toFixed(2),
        Number(m.impressions || 0),
        Number(m.clicks || 0),
        (Number(m.costMicros || 0) / 1e6).toFixed(2),
        Number(m.conversions || 0).toFixed(2),
        Number(m.conversionsValue || 0).toFixed(2),
        Number(m.ctr || 0).toFixed(4),
        (Number(m.averageCpc || 0) / 1e6).toFixed(2),
        (Number(m.costPerConversion || 0) / 1e6).toFixed(2)
      ]);
      count++;
    }
  } catch (e) {
    Logger.log('  campaigns query failed: ' + e);
    errorRows.push([customerId, accountName, 'campaigns', String(e)]);
  }
  return count;
}

// ============================================================
//  SEARCH TERMS (30d, with at least N clicks — see SEARCH_TERM_MIN_CLICKS)
// ============================================================
function searchTermsHeader() {
  return [
    'Customer ID', 'Account Name', 'Campaign Name', 'Ad Group Name',
    'Search Term', 'Status', 'Triggering Keyword',
    'Impressions 30d', 'Clicks 30d', 'Cost 30d', 'Conv 30d', 'Conv Value 30d'
  ];
}

function pullSearchTerms(customerId, accountName, rows, errorRows) {
  var count = 0;
  try {
    var rs = AdsApp.search(
      'SELECT search_term_view.search_term, search_term_view.status, ' +
      '       campaign.name, ad_group.name, ' +
      '       segments.keyword.info.text, ' +
      '       metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
      '       metrics.conversions, metrics.conversions_value ' +
      'FROM search_term_view ' +
      'WHERE metrics.clicks >= ' + SEARCH_TERM_MIN_CLICKS + ' ' +
      'DURING LAST_30_DAYS'
    );
    while (rs.hasNext()) {
      var r = rs.next();
      var stv = r.searchTermView || {};
      var c = r.campaign || {};
      var g = r.adGroup || {};
      var s = r.segments || {};
      var kw = (s.keyword && s.keyword.info) ? (s.keyword.info.text || '') : '';
      var m = r.metrics || {};
      rows.push([
        customerId, accountName,
        c.name || '', g.name || '',
        stv.searchTerm || '', stv.status || '',
        kw,
        Number(m.impressions || 0),
        Number(m.clicks || 0),
        (Number(m.costMicros || 0) / 1e6).toFixed(2),
        Number(m.conversions || 0).toFixed(2),
        Number(m.conversionsValue || 0).toFixed(2)
      ]);
      count++;
    }
  } catch (e) {
    Logger.log('  search terms query failed: ' + e);
    errorRows.push([customerId, accountName, 'search_terms', String(e)]);
  }
  return count;
}

// ============================================================
//  CONVERSION ACTIONS (per account — what's configured?)
// ============================================================
function conversionsHeader() {
  return [
    'Customer ID', 'Account Name',
    'Conv Action ID', 'Conv Action Name', 'Category', 'Type',
    'Status', 'Counting Type', 'Include in Conversions',
    'Default Value', 'Default Currency Code'
  ];
}

function pullConversionActions(customerId, accountName, rows, errorRows) {
  var count = 0;
  try {
    var rs = AdsApp.search(
      'SELECT conversion_action.id, conversion_action.name, ' +
      '       conversion_action.category, conversion_action.type, ' +
      '       conversion_action.status, conversion_action.counting_type, ' +
      '       conversion_action.include_in_conversions_metric, ' +
      '       conversion_action.value_settings.default_value, ' +
      '       conversion_action.value_settings.default_currency_code ' +
      'FROM conversion_action'
    );
    while (rs.hasNext()) {
      var ca = rs.next().conversionAction || {};
      var vs = ca.valueSettings || {};
      rows.push([
        customerId, accountName,
        String(ca.id || ''), ca.name || '',
        ca.category || '', ca.type || '',
        ca.status || '', ca.countingType || '',
        ca.includeInConversionsMetric === true ? 'TRUE' : 'FALSE',
        vs.defaultValue != null ? vs.defaultValue : '',
        vs.defaultCurrencyCode || ''
      ]);
      count++;
    }
  } catch (e) {
    Logger.log('  conversion actions query failed: ' + e);
    errorRows.push([customerId, accountName, 'conversion_actions', String(e)]);
  }
  return count;
}

// ============================================================
//  TRACKING CONFIG (per campaign)
// ============================================================
function trackingHeader() {
  return [
    'Customer ID', 'Account Name',
    'Account Final URL Suffix', 'Account Tracking Template', 'Account Has UTMs',
    'Campaign ID', 'Campaign Name', 'Campaign Status',
    'Campaign Tracking Template', 'Campaign Final URL Suffix',
    'Campaign Has UTMs', 'Effective Has UTMs',
    'Impressions 30d', 'Clicks 30d', 'Cost 30d'
  ];
}

function pullTracking(customerId, accountName, acctSuffix, acctTemplate, rows, errorRows) {
  var acctHasUtms = hasRequiredUTMs(acctSuffix + ' ' + acctTemplate);
  try {
    var rs = AdsApp.search(
      'SELECT campaign.id, campaign.name, campaign.status, ' +
      '       campaign.tracking_url_template, campaign.final_url_suffix, ' +
      '       metrics.impressions, metrics.clicks, metrics.cost_micros ' +
      'FROM campaign ' +
      'WHERE campaign.status != "REMOVED" ' +
      'DURING LAST_30_DAYS'
    );
    var any = false;
    while (rs.hasNext()) {
      any = true;
      var r = rs.next();
      var c = r.campaign || {};
      var m = r.metrics || {};
      var campSuffix = c.finalUrlSuffix || '';
      var campTemplate = c.trackingUrlTemplate || '';
      var campHasUtms = hasRequiredUTMs(campSuffix + ' ' + campTemplate);
      rows.push([
        customerId, accountName,
        acctSuffix, acctTemplate, acctHasUtms ? 'TRUE' : 'FALSE',
        String(c.id || ''), c.name || '', c.status || '',
        campTemplate, campSuffix,
        campHasUtms ? 'TRUE' : 'FALSE',
        (acctHasUtms || campHasUtms) ? 'TRUE' : 'FALSE',
        Number(m.impressions || 0),
        Number(m.clicks || 0),
        (Number(m.costMicros || 0) / 1e6).toFixed(2)
      ]);
    }
    if (!any) {
      // Record the account-level config even with no active campaigns
      rows.push([
        customerId, accountName,
        acctSuffix, acctTemplate, acctHasUtms ? 'TRUE' : 'FALSE',
        '', '(no active campaigns in last 30d)', '',
        '', '', '', acctHasUtms ? 'TRUE' : 'FALSE',
        0, 0, '0.00'
      ]);
    }
  } catch (e) {
    Logger.log('  tracking query failed: ' + e);
    errorRows.push([customerId, accountName, 'tracking', String(e)]);
  }
}

// ============================================================
//  HELPERS
// ============================================================
function errorsHeader() {
  return ['Customer ID', 'Account Name', 'Query', 'Error Message'];
}

function hasRequiredUTMs(str) {
  if (!str) return false;
  return /utm_source/i.test(str) && /utm_medium/i.test(str) && /utm_campaign/i.test(str);
}

function openOrCreateSheet() {
  var files = DriveApp.getFilesByName(SHEET_NAME);
  if (files.hasNext()) {
    return SpreadsheetApp.openById(files.next().getId());
  }
  return SpreadsheetApp.create(SHEET_NAME);
}

function writeTab(ss, tabName, rows) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  sheet.clear();
  if (rows.length === 0) return;
  // Defensive: pad rows so every row has the same column count as the header
  var width = rows[0].length;
  for (var i = 1; i < rows.length; i++) {
    while (rows[i].length < width) rows[i].push('');
    if (rows[i].length > width) rows[i] = rows[i].slice(0, width);
  }
  sheet.getRange(1, 1, rows.length, width).setValues(rows);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  // Auto-resize columns we care about (cap at 12 to keep runtime tight)
  var resizeCols = Math.min(width, 12);
  for (var i = 1; i <= resizeCols; i++) {
    try { sheet.autoResizeColumn(i); } catch (e) {}
  }
}
