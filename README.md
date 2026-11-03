# Minted

Mobile-first app for the household budget in the **Monthly Tracker Budget** Google Sheet: what's due each payday
(15th / 30th), what's paid, what's left, goal progress and card utilization. Paying a bill writes the actual amount
back into the **Rolling Execution Plan** tab, the same way you do it by hand.

- Web/PWA on GitHub Pages now (installable on Android from Chrome → *Add to Home screen*).
- Same codebase can be wrapped as an Android app with Capacitor later (see the end of this file).

## How the app reads your sheet

| Sheet | Used for |
| --- | --- |
| Rolling Execution Plan, header row | `Category · Description · Notes · Payment Method · Monthly Budget · 15th Payday · 30th Payday · <payday dates>` |
| Category `15th Payday`, `30th Payday`, `Equal Split` | Bills |
| Category `New Goal` | Sinking funds (shown with bills) |
| Category `Income`, `Summary` | Payday income, total expenses, surplus (your formulas) |
| Category `Goals` | Actual goal contributions per payday |
| `Card Name` table below the ledger | Card limits and utilization |
| Sheet2 `Financial Goal` rows | Goal targets ("Target 500k") and planned allocation per payday |

Rows are found by their labels, not row numbers, so you can add or reorder bills.

**Paid status.** A bill is paid when its payday cell has a note starting with `Paid` (the app adds
`Paid 2026-11-03 by Ana`), or when, for a payday that has already arrived, the cell differs from the planned
amount (because someone typed the actual amount in). Future cells that differ are treated as a plan change.
A ₱0 cell means "not due that payday".

## One-time setup

### 1. Convert the file to a Google Sheet
The Drive file is an `.xlsx`; Google's API can only write to native Google Sheets.
1. Open the file in Google Drive → **File → Save as Google Sheets**.
2. In the new sheet, **Share** it with both household Google accounts as **Editor**.
3. Copy the new link (the ID is the part between `/d/` and `/edit`).

Keep using the new Google Sheet from now on; the old `.xlsx` stops updating.

### 2. Create a Google OAuth client (free, ~5 minutes)
1. Go to <https://console.cloud.google.com/> → create a project, e.g. *household-ledger*.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → OAuth consent screen** → *External* → fill the app name and your email → add both household
   emails under **Test users**. (Leaving it in *Testing* is fine for personal use.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
   Add **Authorized JavaScript origins**:
   - `http://localhost:5173`
   - `https://<your-github-username>.github.io`
5. Copy the **Client ID** (`…apps.googleusercontent.com`). It is not a secret.

### 3. Run locally
```bash
npm install
cp .env.example .env.local   # then fill VITE_GOOGLE_CLIENT_ID and VITE_SHEET_ID
npm run dev                  # http://localhost:5173/household-finance/
npm test
```
In local dev you can also tap **Try with sample data** (edits stay on the device). `src/data/sample.json` is a
made-up household with the same layout as the real sheet; the tests run against it, and it is never included in the
GitHub Pages build. **This repo is public: never commit real household figures.**
Add `?today=2026-11-15` to the URL to preview another date.

### 4. Deploy to GitHub Pages
1. Create a GitHub repo named `minted` and push this folder to `main`.
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Repo **Settings → Secrets and variables → Actions → Variables**: add `VITE_GOOGLE_CLIENT_ID` and `VITE_SHEET_ID`.
4. Push again (or run the workflow). The app is at `https://<user>.github.io/minted/`.

If you pick a different repo name, the workflow sets the base path from it automatically.

## Android app later (Capacitor)
```bash
npm i @capacitor/core @capacitor/android && npm i -D @capacitor/cli
npx cap init "Minted" com.household.minted --web-dir dist
VITE_BASE=./ npm run build && npx cap add android && npx cap open android
```
Google's web sign-in popup doesn't run inside an Android WebView, so the Android build needs a native sign-in
plugin (e.g. `@capgo/capacitor-social-login`) and an *Android* OAuth client in the same Cloud project; only
`src/lib/backend/googleAuth.ts` has to change.

## Sample data from a real sheet (local only)
`scripts/capture-fixture.mjs` turns a link-shared sheet into the same JSON shape. Use it only for local experiments;
the tests expect the made-up figures, and real figures must never be committed to this public repo.
```bash
curl -sL "https://docs.google.com/spreadsheets/d/<id>/htmlview/sheet?headers=true&gid=<rolling gid>" -o rolling.html
curl -sL "https://docs.google.com/spreadsheets/d/<id>/htmlview/sheet?headers=true&gid=<sheet2 gid>" -o sheet2.html
node scripts/capture-fixture.mjs rolling.html sheet2.html > sample.real.json   # gitignored
```
(Only works while the sheet is link-shared.)
