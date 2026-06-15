# DASHBOARD — setup & deployment guide

A hosted, password-gated revenue dashboard that reads one Google Sheet and shows
your four revenue streams (SaaS, Payment Processing, CAMP, Payroll), restaurant
payment health, an owed/discount view, service segmentation, and a forecast.

It runs on built-in demo data out of the box, so you can deploy first and connect
your real data after.

---

## Files

```
config.js                 ← the ONLY file you edit (sheet URL + password)
index.html                ← page structure
style.css                 ← styling
dashboard.js              ← all logic (don't edit)
vercel.json               ← hosting config (don't edit)
master-sheet-template.csv ← the column layout for your Google Sheet
```

---

## A. Deploy first (10 min, demo data)

### 1. GitHub
1. Create a free account at github.com.
2. Click **+** (top right) → **New repository**. Name it `dashboard`. Keep it **Public**. Create.
3. On the repo page → **uploading an existing file**.
4. Drag in all of: `config.js`, `index.html`, `style.css`, `dashboard.js`, `vercel.json`. Commit.

### 2. Vercel
1. Go to vercel.com → **Sign up** → **Continue with GitHub**.
2. **Add New Project** → import your `dashboard` repo → **Deploy**.
3. ~30 seconds later you get a live URL like `dashboard-xxxx.vercel.app`. Open it.
4. The password gate appears. The default password is `changeme` (see section C to change it).

You now have a live dashboard on demo data. Next, connect your real numbers.

---

## B. Connect your data

### 1. Build the master sheet
1. Open `master-sheet-template.csv` to see the exact columns (also listed below).
2. Create a Google Sheet with those column names in row 1.
3. Each month, paste your finished summary table in as **new rows**, and put the month
   (e.g. `2026-05`) in the `month` column for every row of that batch.

> **Important — paste values, not formulas.** Your working file uses formulas that
> reference other tabs (Stripe Raw Data, CAMP & Payroll). When copying into the master
> sheet, use **Paste special → Values only**. Pasting formulas would break the references.

The columns:

```
month, reference id, restaurant, status, platform, onboarding date,
paused/cancelled date, gross revenue, fees, net revenue, refunds,
platform fee, per day, days in month, payment processing, saas, payroll, camp
```

Notes:
- `gross revenue` is the SaaS portion collected (after CAMP/Payroll are subtracted, as in your file).
- `saas` is the accrued/expected SaaS figure. Health and owed compare `saas` (expected) to `gross` (collected).
- Payment-processing-only restaurants just need `payment processing` filled; leave the SaaS columns 0.
- Numbers only — no `$` or commas inside cells.

### 2. Publish it as CSV
1. In the sheet: **File → Share → Publish to web**.
2. Pick the data tab, change "Web page" to **Comma-separated values (.csv)**, click **Publish**.
3. Copy the URL it gives you.

### 3. Point the dashboard at it
1. In your GitHub repo, open `config.js` → pencil (Edit).
2. Paste the URL between the quotes:
   ```js
   SHEETS_CSV_URL: 'https://docs.google.com/spreadsheets/d/..../pub?output=csv',
   ```
3. Commit. Vercel redeploys in ~30 seconds. Refresh the dashboard — the status dot reads "Live".

---

## C. Set the password

In `config.js`:
```js
PASSWORD: 'changeme',   // ← set your own
```
Commit and it redeploys.

This is a light gate — it keeps casual visitors out, but it is client-side and not
bank-grade. When you want proper per-user logins, that's the Phase 3 upgrade (Supabase auth).

---

## D. Monthly routine

1. Finish your reconciliation as you do today.
2. Paste the final table into the master Google Sheet as new rows (values only), tagged with the month.
3. Done. The dashboard shows it next time it loads. Use the period dropdown to switch between months or "All time".

> Google caches the published CSV for ~5–10 minutes, so brand-new edits may take a few minutes to appear.

---

## Troubleshooting

- **Stuck on demo data / "Demo data" dot** — `config.js` still has an empty `SHEETS_CSV_URL`, or the sheet isn't published as CSV.
- **"Could not load your Google Sheet"** — open the CSV URL directly in a browser; you should see raw comma-separated text. If not, re-publish (section B2).
- **Charts empty or wrong** — check row 1 column names match the list above, dates are real, and numbers have no `$`/commas.
- **#REF or errors in the sheet** — you pasted formulas instead of values (section B1).
- **Custom domain** — Vercel → project → Settings → Domains.
