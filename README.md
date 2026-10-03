# Shiftly — personal Shift Scanner, Calendar & Salary Calculator

A responsive React + TypeScript + Vite PWA. No account required. Starts empty: no simulated shifts, salary or scanning results. IndexedDB stores settings, planned shifts and actual sessions. Documents and scanner tokens are never persisted by the app.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. On Windows PowerShell, use `npm.cmd` if execution policy prevents `npm.ps1`. `npm test` runs the calculation/persistence tests; `npm run build` creates `dist`; `npm run preview` serves the production build. Offline and install support are enabled on the production build over HTTPS or localhost, after the first online visit. Use your browser’s Install app / Add to Home Screen action. No automatic device sync: export backups to move records between devices.

## Deploy frontend to GitHub Pages

1. Create a GitHub repository and push these files to its `main` branch, including `package-lock.json`. Do not commit `.env` files or secrets.
2. In repository Settings → Pages, choose **GitHub Actions** as source.
3. The included `.github/workflows/deploy.yml` installs dependencies, runs tests, builds and deploys. Relative Vite URLs support repository Pages paths.
4. Open `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/` after the workflow finishes.

The app works without a scanner. Manual entry, timer, reports and backup remain usable offline. GitHub Pages cannot run the scanner backend.

## Deploy optional secure AI scanner separately

The personal deployment is now at `https://shiftly-scanner.shiftly-scanner.workers.dev`, which is the default endpoint for new and previously unconfigured installations. Custom endpoints remain unchanged. This endpoint needs server-side credentials before scanning is usable. `backend/configure-token.mjs` configures a random scanner token via standard input and saves only that token to the Git-ignored `backend/.scanner-token` file; it never prints the token or saves the OpenAI API key. Keep that file private. `npm run deploy` validates that both credentials are encrypted secrets and captures Wrangler output because dashboard configuration comparisons can contain plain-variable values. Never add an API key as a normal Text variable; choose Secret. If a credential appears in any output, revoke and replace it.

The `backend/` Cloudflare Worker accepts one rendered image/page per request and uses image input plus strict JSON extraction. It authenticates with a separate personal access token, enforces the configured origin and request size, and keeps the AI API key server-side. The token grants scanning access only and is held in browser memory until reload, never included in backups. Requests are processed sequentially with timeouts; failures produce honest errors rather than sample results.

1. Create a Cloudflare account and an OpenAI API project with access to the configured vision model. Set a small project spend limit. Provider processing may incur charges.
2. In `backend/wrangler.toml`, set `ALLOWED_ORIGIN` to your exact frontend origin (for Pages: `https://YOUR_USERNAME.github.io`, without repository path). Adjust `SCAN_MODEL` if necessary.
3. Run:

```sh
cd backend
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put SCAN_TOKEN
npm run deploy
```

Use a long randomly generated private value for `SCAN_TOKEN`. Keep it private; anyone who knows it can spend your scanning budget. API keys go only into Worker secrets. CORS is an additional restriction, not a replacement for token authentication. For local backend testing, copy `.dev.vars.example` to ignored `.dev.vars`, fill values locally, set origin to `http://localhost:5173`, and run `npm run dev` in the backend.

4. Enter the deployed Worker HTTPS URL in app Settings and save. Enter your personal scanner token on Scan before starting. An optional frontend `.env` may set `VITE_SCANNER_URL` (URL only); the endpoint can also be changed directly in Settings.
5. Choose photos/screenshots/PDFs and explicitly start scanning. Every PDF page is rendered locally and sent individually. Each file is limited to 20 MB and 30 PDF pages; page images are downscaled. Rotate unreadable sheets or upload sharper originals and retry. Inspect every result against the source and confirm each selected row before importing. Missing year/month, unknown codes and unclear times stay blank for your correction. No inferred work for days off.

Uploaded documents are untrusted data in a separate model input; the server instructs the model to ignore embedded commands and return only the requested employee’s shifts. AI extraction is not guaranteed accurate. No extraction becomes a calendar entry without source review. Missing break information is marked for review, initially showing zero. Files remain in memory for source previews; Delete uploaded sources releases them. Other employees’ rows are not included in saved calendar data. No request bodies are logged in Worker code. External providers may retain data according to their policies; review [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). Implementation references: [image inputs](https://developers.openai.com/api/docs/guides/images-vision) and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Fixtures include `sample-shift-sheet.html`, a ready-to-upload PNG, and `sample-multipage-shift-sheet.pdf`. All are clearly labeled SAMPLE and include ゼーリン, other employees, and overnight codes with explicit legends. The second PDF page includes an unresolved time code to exercise manual review. These are never injected as scanner output. `node scripts/create-fixtures.mjs` regenerates the image/PDF using installed Edge; set `BROWSER_CHANNEL=chrome` to use Chrome.

## Calculation rules and assumptions

- Default employee name: **ゼーリン**. Name comparison applies Unicode NFKC and removes whitespace; settings allow comma-separated aliases.
- Regular rate ¥1,200/hour; night rate ¥1,200 × 1.43 = ¥1,716/hour. Night window 22:00–05:00. **05:00 is an editable assumption.** All amounts are estimates of configured rules, without payroll deductions or overtime rules.
- Millisecond timestamps and the recorded IANA timezone determine work intervals. Unpaid breaks are removed, each interval is split across night boundaries, all night time is summed, then rounded down **once per session** to completed 15-minute blocks. Regular elapsed time is not rounded down. The final total defaults to nearest whole yen; floor and precision options are available.
- 22:00–22:20 = ¥429; 22:00–22:40 = ¥858; 22:00–22:50 = ¥1,287; 22:00–23:10 = ¥1,716; 21:00–22:20 = ¥1,629. Minutes are used internally, never misleading decimal-hour notation.
- Every session captures the rules when started. Completed history and corrections continue using that snapshot even after settings change.
- Planned shifts do **not** count as earned money. End time at or before start means the following day. For planned shifts with only a break duration and no timing, estimates assume that break occurs at the beginning; actual session breaks use exact timestamps.
- Monthly totals are derived from sessions, assigned to the month of the start date in the session’s recorded timezone. Overnight and cross-month work remains in the starting month. No rollover deletes data. Completed totals and active estimates are separate.
- Timer recovery uses timestamps, not counted intervals. Actions are committed in one IndexedDB transaction, preventing concurrent active sessions across tabs. Closing/locking the device does not stop elapsed-time calculation. End while on break closes the break at the same timestamp.
- Backward action timestamps and active shifts longer than 36 hours are flagged; durations longer than seven days are rejected. The app cannot prove elapsed time after an offline device clock change: inspect and correct questionable records. Device locale is used for the live display; date/time editing controls follow browser conventions. All calculations use stored zones.

## Backup, restore and privacy

Settings → Export JSON backup saves the schema-versioned complete local state. Restore validates date/time, pay rules, timezone, breaks, IDs and the single-active-session invariant. Merge preserves current settings, skips duplicate sessions/shifts, and rejects conflicts for manual resolution. Replace prompts for confirmation. Clear data prompts twice; export first. Calendar deletions offer undo for the current app visit. Browser storage is device-specific and may be evicted; backups are essential. Export files contain sensitive personal records and should be stored privately.

Reports provide month selection, completed-session totals, daily earnings chart, editable session details, CSV and printable layout. CSV exports full start/end dates and recorded timezone. Print from Monthly Reports.

## Tests

`src/model.test.ts` covers exact 22:00/05:00 boundaries, 14/15/29/30/44/45/60-minute blocks, multiple night intervals summed once, boundary-spanning breaks, overnight work, recorded-zone cross-month attribution, closed-app rollover, settings snapshots, corrections updating reports, invalid clocks/breaks, duplicate/conflicting imports, validated backups, IndexedDB timer recovery and simultaneous start transactions. `backend/worker.test.js` checks origin/token protection, missing credentials, invalid uploads, provider failures and server-only API authentication. The external scanner needs deployment, credentials and source review to verify end-to-end; no live scan is claimed by the tests.

With the production preview server running on port 4173, `npm run test:browser` uses installed Edge to check desktop/mobile layouts, timer refresh, breaks and completion, calendar creation/deletion/undo, reports, dark mode, Japanese and offline reload. Set `BROWSER_CHANNEL=chrome` to use Chrome instead. Screenshots are written to ignored `artifacts/`. These checks use an isolated browser context and never modify your personal app records.
