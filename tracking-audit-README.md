# Skyway — Google Ads Tracking Audit

**What this is:** A small read-only script that runs inside Google Ads MCC,
checks every child account's UTM tracking setup, and writes the results to a
Google Sheet. Skyway OS uses the output to flag accounts where lead
attribution from Google Ads → HubSpot / GoHighLevel is broken.

**What this is NOT:** This script changes nothing in Google Ads. It only
reads the tracking template + final URL suffix that's already there. No
campaigns, ads, budgets, or settings are touched.

---

## 5-minute install (Aaron's Google Ads person)

1. Sign in to **Google Ads MCC** as `analytics@skyway.media`.
2. Top-right gear → **Tools & settings** → **Bulk actions** → **Scripts**.
3. Click the blue **+** button → **New script**.
4. Name it `Skyway — Tracking Audit`.
5. Delete the placeholder code in the editor.
6. Open `tracking-audit.gs` from the Skyway repo, copy the entire contents,
   paste them into the editor.
7. Click **Authorize** (Google will ask permission to read your Ads accounts
   and write to Google Sheets — both are required, both are read-only against
   Ads). Approve.
8. Click **Run** (▶︎ icon). It will run for roughly 3 minutes on 88
   accounts. The "Logs" panel at the bottom shows progress.
9. When it's done, the last log line will say something like
   `Sheet URL: https://docs.google.com/spreadsheets/d/…`. Open that URL.
10. In the Sheet, click **Share** (top right). Add `emily@skyway.media` with
    **Viewer** access. Click Send.
11. Copy the Sheet URL and send it to Aaron in Slack or email. We're done.

---

## To schedule it daily (optional but recommended)

After the first successful run, on the Scripts screen find the
`Skyway — Tracking Audit` row, click the **Frequency** dropdown next to it,
choose **Daily**. Pick any time. From then on, the Sheet refreshes
automatically every morning — no manual re-run.

---

## What's in the Sheet

One row per campaign across every account in the MCC. Columns:

| Column | Meaning |
|---|---|
| Account ID, Account Name | Which Google Ads account |
| Is LSA (by name) | Heuristic — TRUE if the account name contains "LSA" / "Local Service Ads" |
| Account Final URL Suffix | Account-level UTM string, if set. *This is what Skyway recommends using.* |
| Account Tracking Template | Account-level template, if set (older mechanism) |
| Account Has UTMs | TRUE if account-level config contains utm_source + utm_medium + utm_campaign |
| Campaign ID, Campaign Name, Status | Per-campaign identifiers |
| Campaign Tracking Template, Campaign Final URL Suffix | Per-campaign overrides, if any |
| Campaign Has UTMs | TRUE if campaign-level config has the three UTM params |
| **Effective Has UTMs** | TRUE if either account- or campaign-level provides them. This is the column that matters most. |
| Impressions / Clicks / Cost (30d) | So we can prioritize fixes by spend |

**The "Effective Has UTMs" column is the single source of truth.** If a row
shows FALSE, that campaign's clicks aren't being tagged — leads from it land
in HubSpot or GoHighLevel as "direct" / "google organic" instead of being
attributed back to the specific campaign.

---

## How Skyway OS uses this data

1. Aaron pastes the Sheet URL (or the contents) into a Claude session.
2. Claude parses it and bakes a per-account `TRACKING_DATA` constant into
   `accounts.html` + `account.html`.
3. The next push updates the "Tracking Health" badge in the accounts list
   and the per-account detail page. Accounts with `Effective Has UTMs =
   FALSE` show as red ("UTMs missing"). Partial coverage shows as amber.
4. The per-account page surfaces a Copy-able recommended UTM template plus
   a deep link to that account's URL settings, so the operator pastes →
   saves → done. Still inside Skyway's read-only rule: Claude never writes
   to Google Ads, the operator does the click.

---

## The recommended Skyway UTM template

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}&gclid={gclid}
```

Set this once at the **account level** (Google Ads → ⚙ Settings → Account
settings → Tracking → **Final URL suffix**). Every campaign in the account
inherits it within an hour. The values in `{curly braces}` are Google's
ValueTrack placeholders — Google replaces them with the real campaign /
ad-group / keyword at click time. `{gclid}` is the Google Click ID, which
HubSpot and GoHighLevel use to match each lead back to the exact click.

**Why account-level and not per-campaign?** One setting covers existing AND
future campaigns. Per-campaign tracking means every new campaign starts
broken until someone remembers to set it.

---

## If something goes wrong

- **"Authorization required"** when first running: click the link Google
  gives you, sign in with `analytics@skyway.media`, accept the scopes.
- **Script times out** (rare with ~88 accounts): re-run; the Sheet will
  contain partial results. Or filter to a smaller account set by editing
  the iterator at the top of `main()`.
- **Some rows say "ERROR"**: those accounts had a permission or query
  problem. The error message is in the row. Most often it's a brand-new
  account with no campaigns yet — safe to ignore.
- **Sheet not found later:** the script always uses a Sheet named
  `Skyway — Google Ads Tracking Audit` in the script-owner's Drive. If it
  was deleted, the next run creates a fresh one.

---

## Read-only guarantee

Both queries the script runs are GAQL SELECT statements against the
`customer` and `campaign` resources. The Google Ads Scripts API enforces
that SELECT queries cannot mutate state. No `update_*`, no `create_*`, no
`remove_*` calls anywhere in the script. Inspect `tracking-audit.gs` for
yourself before running — the entire file is ~120 lines.
