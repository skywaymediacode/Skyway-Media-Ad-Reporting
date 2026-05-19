/**
 * Skyway Media — Google Ads MCC Tracking Audit
 * ---------------------------------------------
 * READ-ONLY. Iterates every account under the MCC, pulls the account-level
 * Final URL suffix + Tracking template plus every campaign's URL settings,
 * and writes the results to a Google Sheet. No campaigns, ads, or settings
 * are modified — this only reads.
 *
 * Where to install:
 *   Google Ads MCC (analytics@skyway.media)
 *   → Tools & settings → Bulk actions → Scripts → New script
 *   → Paste this entire file → Authorize → Run
 *
 * Output:
 *   A Google Sheet titled "Skyway — Google Ads Tracking Audit" in the script
 *   owner's Drive. Each row = one campaign, with the account- and campaign-
 *   level UTM/tracking config side by side.
 *
 * Re-run cadence:
 *   First run: manual, ~3 minutes for ~88 accounts.
 *   Then: schedule daily inside Google Ads Scripts → Frequency: Daily.
 *
 * After it runs:
 *   Share the Sheet with emily@skyway.media (read access is fine), then send
 *   Aaron the link. The Skyway OS UI ingests this sheet into TRACKING_DATA
 *   so the per-account Tracking Health section in account.html lights up.
 */

var SHEET_NAME = 'Skyway — Google Ads Tracking Audit';
var DATE_RANGE = 'LAST_30_DAYS';   // window for impressions/clicks/cost stats
var SKIP_LSA_NAME_PATTERN = /(LSA|Local Service Ads)/i;  // logged but not treated specially here

function main() {
  var startedAt = new Date();
  Logger.log('Tracking audit started at ' + startedAt.toISOString());

  var rows = [];      // 2D array we'll write to the sheet
  var summary = { accounts_total: 0, accounts_with_errors: 0, campaigns_total: 0 };

  // HEADER ROW
  rows.push([
    'Account ID', 'Account Name', 'Is LSA (by name)',
    'Account Final URL Suffix', 'Account Tracking Template',
    'Account Has UTMs',
    'Campaign ID', 'Campaign Name', 'Status',
    'Campaign Tracking Template', 'Campaign Final URL Suffix',
    'Campaign Has UTMs',
    'Effective Has UTMs (account OR campaign)',
    'Impressions ' + DATE_RANGE,
    'Clicks ' + DATE_RANGE,
    'Cost ' + DATE_RANGE
  ]);

  // Iterate child accounts under the MCC
  var accountIter = AdsManagerApp.accounts().get();
  while (accountIter.hasNext()) {
    var account = accountIter.next();
    summary.accounts_total++;
    var customerId = account.getCustomerId();   // returns "123-456-7890"
    var customerIdClean = customerId.replace(/-/g, '');
    var accountName = account.getName() || '';
    var isLsaByName = SKIP_LSA_NAME_PATTERN.test(accountName);

    try {
      AdsManagerApp.select(account);

      // 1. Account-level config (Customer entity)
      var acctSuffix = '';
      var acctTemplate = '';
      try {
        var customerIter = AdsApp.search(
          'SELECT customer.final_url_suffix, customer.tracking_url_template ' +
          'FROM customer LIMIT 1'
        );
        while (customerIter.hasNext()) {
          var crow = customerIter.next();
          acctSuffix = (crow.customer && crow.customer.finalUrlSuffix) || '';
          acctTemplate = (crow.customer && crow.customer.trackingUrlTemplate) || '';
        }
      } catch (cerr) {
        Logger.log('[' + customerIdClean + '] customer-level query failed: ' + cerr);
      }
      var acctHasUtms = hasRequiredUTMs(acctSuffix + ' ' + acctTemplate);

      // 2. Campaign-level config
      var campaignCount = 0;
      try {
        var campIter = AdsApp.search(
          'SELECT campaign.id, campaign.name, campaign.status, ' +
          '       campaign.tracking_url_template, campaign.final_url_suffix, ' +
          '       metrics.impressions, metrics.clicks, metrics.cost_micros ' +
          'FROM campaign ' +
          'WHERE campaign.status != "REMOVED" ' +
          'DURING ' + DATE_RANGE
        );
        while (campIter.hasNext()) {
          var row = campIter.next();
          var c = row.campaign || {};
          var m = row.metrics || {};
          var campSuffix = c.finalUrlSuffix || '';
          var campTemplate = c.trackingUrlTemplate || '';
          var campHasUtms = hasRequiredUTMs(campSuffix + ' ' + campTemplate);
          var effectiveHasUtms = acctHasUtms || campHasUtms;
          rows.push([
            customerIdClean, accountName, isLsaByName ? 'TRUE' : 'FALSE',
            acctSuffix, acctTemplate, acctHasUtms ? 'TRUE' : 'FALSE',
            String(c.id || ''), c.name || '', c.status || '',
            campTemplate, campSuffix, campHasUtms ? 'TRUE' : 'FALSE',
            effectiveHasUtms ? 'TRUE' : 'FALSE',
            Number(m.impressions || 0),
            Number(m.clicks || 0),
            (Number(m.costMicros || 0) / 1e6).toFixed(2)
          ]);
          campaignCount++;
          summary.campaigns_total++;
        }
      } catch (camperr) {
        Logger.log('[' + customerIdClean + '] campaign-level query failed: ' + camperr);
        rows.push([
          customerIdClean, accountName, isLsaByName ? 'TRUE' : 'FALSE',
          acctSuffix, acctTemplate, acctHasUtms ? 'TRUE' : 'FALSE',
          'ERROR', String(camperr), '', '', '', '', '', 0, 0, '0.00'
        ]);
        summary.accounts_with_errors++;
      }

      // If the account has no campaigns at all, still record one row so we
      // know we audited it.
      if (campaignCount === 0) {
        rows.push([
          customerIdClean, accountName, isLsaByName ? 'TRUE' : 'FALSE',
          acctSuffix, acctTemplate, acctHasUtms ? 'TRUE' : 'FALSE',
          '', '(no active campaigns in last 30d)', '',
          '', '', '', acctHasUtms ? 'TRUE' : 'FALSE',
          0, 0, '0.00'
        ]);
      }

      Logger.log('[' + customerIdClean + '] ' + accountName +
                 ' — ' + campaignCount + ' campaigns, acct UTMs: ' + acctHasUtms);
    } catch (e) {
      Logger.log('[' + customerIdClean + '] account-level error: ' + e);
      summary.accounts_with_errors++;
      rows.push([
        customerIdClean, accountName, isLsaByName ? 'TRUE' : 'FALSE',
        'ERROR', String(e), 'FALSE',
        '', '', '', '', '', '', '', 0, 0, '0.00'
      ]);
    }
  }

  // Write to sheet
  var sheetUrl = writeToSheet(rows);
  var elapsed = ((new Date()).getTime() - startedAt.getTime()) / 1000;
  Logger.log('---');
  Logger.log('Audit complete in ' + elapsed.toFixed(1) + 's');
  Logger.log('Accounts:   ' + summary.accounts_total);
  Logger.log('Errors:     ' + summary.accounts_with_errors);
  Logger.log('Campaigns:  ' + summary.campaigns_total);
  Logger.log('Sheet URL:  ' + sheetUrl);
  Logger.log('Send the Sheet URL to Aaron for ingestion into the Skyway OS.');
}

function hasRequiredUTMs(str) {
  if (!str) return false;
  return /utm_source/i.test(str) && /utm_medium/i.test(str) && /utm_campaign/i.test(str);
}

function writeToSheet(rows) {
  // Look for the existing sheet; create it if missing.
  var ss;
  var files = DriveApp.getFilesByName(SHEET_NAME);
  if (files.hasNext()) {
    ss = SpreadsheetApp.openById(files.next().getId());
  } else {
    ss = SpreadsheetApp.create(SHEET_NAME);
  }
  // Use the first tab; clear & rewrite each run so the sheet is always current.
  var sheet = ss.getSheets()[0];
  sheet.clear();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  // Format the header row
  sheet.getRange(1, 1, 1, rows[0].length)
       .setFontWeight('bold')
       .setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  // Auto-resize columns we care most about
  for (var i = 1; i <= rows[0].length; i++) {
    try { sheet.autoResizeColumn(i); } catch (e) {}
  }
  return ss.getUrl();
}
