# Skyway — Google Ads MCC Comprehensive Data Pull

**What this is:** A single read-only script that runs inside Google Ads MCC,
pulls everything Skyway OS needs for cross-account visibility, and writes
it to a multi-tab Google Sheet. Replaces Supermetrics for the Google side
entirely. Free.

**What this is NOT:** This script changes nothing in Google Ads. Every
query is a GAQL `SELECT`. No `.pause()`, no `.enable()`, no `.remove()`, no
budget changes, no settings touched. Read-only by both code review and API
contract.

---

## 5-minute install (Aaron's Google Ads person)

1. Sign in to **Google Ads MCC** as `analytics@skyway.media`.
2. Top-right gear → **Tools & settings** → **Bulk actions** → **Scripts**.
3. Click the blue **+** button → **New script**.
4. Name it `Skyway — MCC Data Pull`.
5. Delete the placeholder code in the editor.
6. Open `skyway-mcc-pull.gs` from the Skyway repo, copy the entire
   contents, paste them into the editor.
7. Click **Authorize**. Google will list two permissions:
   - "View your Google Ads accounts" (read-only)
   - "See, edit, create, and delete your Google Sheets spreadsheets"
     (for the output Sheet — not Google Ads itself)
   Approve.
8. Click **Run** (▶︎). First run takes ~5–10 minutes for 88 accounts. The
   "Logs" panel at the bottom shows progress.
9. Last log line will say `Sheet: https://docs.google.com/spreadsheets/d/…`.
   Open it.
10. In the Sheet, click **Share** → add `emily@skyway.media` with
    **Viewer** access. Send Aaron the Sheet URL.

---

## Schedule it daily (recommended)

After the first successful run, back on the Scripts list, find
`Skyway — MCC Data Pull`, click the **Frequency** dropdown next to it,
choose **Daily**. From then on the Sheet refreshes automatically every
morning — no manual re-run, no ongoing work.

---

## What's in the Sheet

Six tabs. Each refreshes in place every run.

### `Accounts` — one row per account (88 rows)

The portfolio snapshot. Per-account: currency, time zone, Google's
optimization score, status, and totals for the last 7 / 30 / 90 days
(spend, clicks, conversions, CPA). Also the account-level tracking config.

This is what powers the main `accounts.html` view and the per-account KPI
cards in Skyway OS.

### `Campaigns` — one row per campaign (~500–1,500 rows)

30-day performance per campaign: status, channel type (Search / Display /
PMax / etc.), bidding strategy, daily budget, impressions, clicks, cost,
conversions, conversion value, CTR, average CPC, cost per conversion.

This is the foundation for the per-account drill-down and the AI
recommendations.

### `Search Terms` — one row per search term that got a click in 30d

The big one. For every campaign in every account, every actual search term
that triggered an ad and got a click in the last 30 days. Spend, clicks,
conversions, conversion value, plus which keyword triggered it.

**This is where most of the recoverable spend hides.** Wrong-geography
queries on a local business account, competitor names you didn't intend to
bid on, generic research-phase queries that never convert — all of it
shows up here, with dollar amounts attached. Roughly 5–10K rows total
across all 88 accounts.

### `Conversion Actions` — one row per configured conv event per account

For each account, every conversion action set up in Google Ads: name,
category (lead, purchase, etc.), type (website, phone call, import, etc.),
status, whether it's counted in the "Conversions" column, default value,
currency.

Lets us see at a glance which accounts have proper conversion tracking
configured at all — versus the ones running blind.

### `Tracking Config` — one row per campaign

Per-campaign UTM and tracking template config, with the account-level
defaults shown alongside. The "Effective Has UTMs" column is the single
source of truth: TRUE if either the account or campaign tags clicks with
`utm_source` + `utm_medium` + `utm_campaign`.

Powers the "Tracking Health" badge in Skyway OS and the per-account fix
recommendations.

### `Errors`

Per-account, per-query errors. If anything fails (a brand-new account
with no campaigns, a permission glitch, an unsupported field on certain
account types), it lands here with the error message. Usually empty;
when non-empty it's the first place to look.

---

## How Skyway OS uses this Sheet

1. Aaron pastes the Sheet URL (or the contents of any tab) into a Claude
   session.
2. Claude parses it and bakes the data into the right JS constants in the
   repo's HTML files:
   - `Accounts` tab → `DATA.accounts` in `account.html` + `DATA.rows` in
     `accounts.html`
   - `Campaigns` tab → per-account campaign list in the drill-down
   - `Search Terms` tab → drives the `search_term_waste` factor and the
     "add as negatives" recommendations
   - `Conversion Actions` tab → flags accounts with no/missing conv setup
   - `Tracking Config` tab → drives the Tracking Health badge
3. Next push, Skyway OS updates with fresh real data across every view.

---

## Read-only guarantee — how to verify before running

Anyone can audit this script in under 5 minutes:

1. **Read the file.** It's about 280 lines, well-commented.
2. **Grep for mutation methods.** None of these appear anywhere in the
   file: `.pause(`, `.enable(`, `.remove(`, `.setBudget(`, `.setBid(`,
   `.setName(`, `newCampaignBuilder`, `newAdGroupBuilder`, `mutate`,
   `MutateRequest`. The script has no way to change anything in Google
   Ads even if I wanted it to.
3. **Check the GAQL queries.** Every query starts with `SELECT`. Google's
   API rejects mutation operations on SELECT queries at the server side —
   this is a contract guarantee, not a script-level choice.
4. **Check the authorization scopes.** When Google's authorization popup
   appears, it should ask only for the two permissions listed in step 7
   above. If it asks for "edit your Google Ads accounts," that's a red
   flag — it won't.

---

## Costs

- Google Ads Scripts: **free** (built into Google Ads)
- Google Sheets storage: **free**
- Skyway's existing Google Workspace account: already paid, no new spend
- Total ongoing cost: **$0/month** (replaces ~$100–200/mo Supermetrics
  for the Google side)

---

## Troubleshooting

- **"Authorization required" on first run** — click the link Google
  provides, sign in with `analytics@skyway.media`, accept the scopes.
- **Script times out at 30 minutes** — rare with 88 accounts, but if it
  happens: re-run, and any tab that didn't finish writing will be
  re-populated. Or temporarily raise `SEARCH_TERM_MIN_CLICKS` at the top
  of the script to a higher number (e.g., 5) to cut the search-terms tab
  in half.
- **Some accounts show in the Errors tab** — usually brand-new accounts
  with no data, accounts of types that don't support certain fields
  (e.g., Smart campaigns vs Standard), or LSAs that don't have
  search-term data. Safe to ignore unless a specific account is missing
  from a tab where you expect it.
- **Sheet not found later** — the script always uses a Sheet named
  `Skyway — Google Ads MCC Data Pull` in the script-owner's Drive. If it
  was deleted, the next run creates a fresh one.
