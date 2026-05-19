# Skyway — Meta Marketing API Comprehensive Pull

**What this is:** A daily GitHub Action that pulls the entire dataset
from Meta Ads (campaigns, ad sets, ads, insights across 7/30/90d windows)
using a System User Token from Business Manager. Writes a JSON snapshot
to `data/meta-pull.json` in this repo. Replaces Supermetrics for Meta
entirely. Free.

**What this is NOT:** This pull changes nothing in Meta. Every API call
is an HTTP GET. There are no POST, PUT, or DELETE calls anywhere in the
script. Meta's API enforces this at the server side too. Read-only by
both code and contract.

---

## One-time setup

### Step 1 — Generate a System User Token (Sara Rose does this)

A System User is the recommended way to give programmatic access to ad
accounts without tying access to a real person's user account or
password. The token doesn't expire if marked "Never expire" at creation,
survives password changes, and can only do what its granted permissions
allow (in our case, read-only).

1. Sign in to **Meta Business Manager** as Sara Rose
   (`business.facebook.com`).
2. Top-left menu → **Settings** → **Business Settings**.
3. Left rail: **Users** → **System Users**.
4. Click **Add** → give it a name like `Skyway Reporting (read-only)` →
   role: **Employee** (not Admin). Save.
5. Click the new system user. On the right, click **Add Assets** →
   **Ad Accounts** → select **all the Skyway ad accounts** → under
   "Partial access," check ONLY:
   - ✅ **View performance** (this maps to `ads_read`)
   - Leave **Manage campaigns** UNCHECKED — that's the write permission.
   - Leave everything else unchecked.
6. Click **Generate New Token** for this system user.
7. App: pick any Meta app Skyway owns (if none exists, create a basic
   one in `developers.facebook.com` first — name it "Skyway Reporting,"
   set use case to "Other → Marketing API," nothing else needed).
8. Scopes to check: **ONLY** these two:
   - ✅ `ads_read`
   - ✅ `business_management`
   - Leave `ads_management` UNCHECKED. That's the write scope.
9. **Token expiration:** set to **Never**.
10. Click **Generate Token**. Copy it immediately — Meta only shows it
    once. Send it to Aaron via password manager (1Password, etc.) or
    Signal — don't paste in regular Slack/email.

### Step 2 — Add the token to the repo as a GitHub secret (Aaron does this)

1. Open the repo on GitHub:
   `https://github.com/skywaymediacode/Skyway-Media-Ad-Reporting`
2. **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**.
3. Name: `META_TOKEN` (exact spelling, all caps).
4. Value: paste the token from Step 1.
5. Click **Add secret**.

### Step 3 — Run it once manually to confirm

1. Repo → **Actions** tab.
2. Left rail: **Meta Data Pull**.
3. Top right: **Run workflow** → **Run workflow** (green button).
4. Refresh after ~2 minutes. Click into the run, then the `pull` job, then
   "Pull Meta data" step. You should see one log line per account, ending
   with `Output: data/meta-pull.json`.
5. Open `data/meta-pull.json` in the repo. Confirm it has ~14 entries
   under `accounts[]`.

After that, the workflow runs daily at 09:00 UTC (≈ 5am ET) automatically
and commits a fresh snapshot only if something changed.

---

## What's in `data/meta-pull.json`

```jsonc
{
  "generated_at": "2026-05-19T09:00:00.000Z",
  "api_version": "v23.0",
  "account_count": 14,
  "accounts": [
    {
      "account_id": "act_795645873022538",
      "account_name": "Adirondack Furniture",
      "account_status": 1,                    // 1 = ACTIVE
      "effective_status": "ACTIVE",
      "currency": "USD",
      "timezone": "America/New_York",
      "spend_cap": "...",
      "amount_spent": "...",
      "business": { "id": "...", "name": "..." },

      "insights": {                            // account totals
        "last_7d":  { "spend": "...", "clicks": "...", "actions": [...], ... },
        "last_30d": { ... },
        "last_90d": { ... }
      },
      "campaigns":             [ ... ],        // every campaign
      "campaign_insights_30d": [ ... ],        // per-campaign 30d perf
      "adsets":                [ ... ],        // every ad set incl. targeting
      "adset_insights_30d":    [ ... ],
      "ads":                   [ ... ],        // every ad incl. creative
      "ad_insights_30d":       [ ... ],
      "errors":                [ ... ]         // empty unless something failed
    },
    // ... 13 more accounts
  ]
}
```

That's the same coverage Supermetrics gave us, in one file, refreshed
daily, for $0/mo.

---

## How Skyway OS uses this data

For now, same pattern as everything else: paste the file contents (or a
link to it) into a Claude session, Claude bakes the relevant fields into
the right JS constants in `meta-accounts.html`, `meta-account.html`,
`client.html`. Next push, every Meta view in Skyway OS shows fresh data.

Later, we can refactor the Meta pages to fetch `data/meta-pull.json`
directly on load (Kinsta serves it as a static file), so the data
refreshes without a Claude session at all. That's a separate ~30-minute
project once we want it.

---

## Read-only guarantee — how to verify before merging

The Meta token has the same threat model as a SaaS password — if leaked,
someone could read your ad performance but cannot change anything,
because the token only has `ads_read` + `business_management` scopes
(both read-only). The write scope (`ads_management`) was deliberately
NOT granted in Step 1.6 and Step 1.8 above.

You can audit the puller script directly:

1. **Read `scripts/meta-pull.js`** — about 200 lines, well-commented.
2. **Grep for write methods:**
   ```bash
   grep -E "method:\s*['\"](POST|PUT|DELETE|PATCH)['\"]|fetch\([^)]*method" scripts/meta-pull.js
   ```
   Returns nothing. Every call uses `fetch(url, { method: 'GET' })`.
3. **Verify the token scopes** by running the Graph API debugger:
   `https://developers.facebook.com/tools/debug/accesstoken/` — paste the
   token, check that "Scopes" shows ONLY `ads_read` and
   `business_management`. If it shows `ads_management`, regenerate the
   token without that scope.

---

## Costs

- Meta Marketing API: **free** (rate-limited but well within our needs at
  14 accounts)
- GitHub Actions: **free** for public repos; private repos get 2,000
  free minutes/month. This workflow uses ~2 minutes per run × 30 days =
  60 minutes/month — well within either tier.
- Total ongoing cost: **$0/month** (replaces ~$100–200/mo Supermetrics
  for the Meta side)

---

## Troubleshooting

- **Workflow run fails with "META_TOKEN env var is required"** — Aaron
  forgot to add the secret in Step 2. Add it, re-run.
- **First account works, rest fail with `code 4` or `code 17`** — Meta
  rate limit. The script auto-retries with backoff; if it still fails,
  re-run in 15 minutes. Meta's rate limit window is one hour and we'll
  be well under it on the second try.
- **A specific account has errors but others don't** — the per-account
  `errors[]` array will say which query failed. Most common cause:
  account is suspended or restricted by Meta, which Skyway can't fix.
  Other accounts in the same run are unaffected.
- **Some accounts missing from `accounts[]`** — Sara Rose didn't grant
  the System User access to every Skyway account in Step 1.5. Go back to
  Business Settings → System Users → click the system user → Ad Accounts
  → Add the missing ones.

---

## Two tokens to keep secure

| Token | Where it lives | If leaked, attacker can | If leaked, attacker CANNOT |
|---|---|---|---|
| `META_TOKEN` (System User) | GitHub repo secret only | Read all Skyway Meta ad performance | Change budgets, pause/start ads, withdraw money, post to Pages |
| Sara Rose's personal Meta password | Sara Rose's password manager | Full Meta account access | n/a (this is the dangerous one — keep it locked down) |

The whole point of System User tokens is to NOT have to use a personal
account for automation. If the System User Token is ever compromised
(GitHub breach, etc.), Sara Rose can revoke it from Business Settings
without it affecting her personal Meta account, and we regenerate.
