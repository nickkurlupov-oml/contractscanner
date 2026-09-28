# Effectiff Scanner

Photograph checks, group by company, compile a PDF of both sides, and
send to Rocket.Chat. Phase 2 adds QuickBooks invoice matching.

This repo has two things in it:

- **`index.html`** — the original web version (works standalone, no
  backend needed for the check-scanning flow; Rocket.Chat credentials
  are stored in the browser's localStorage).
- **`netlify/functions/`** — a small serverless backend, needed only for
  the QuickBooks piece, since QuickBooks' OAuth client secret can't live
  in code that ships to a browser or an app.

The **iOS app** (separate project, `EffectiffScanner-iOS.zip`) reuses
this same backend for QuickBooks — same reasoning: an OAuth secret can't
live in an App Store binary either. Deploy this once, and both the web
app and the iOS app can point at it.

## Deploying

1. Push this repo to GitHub.
2. Netlify → Add new site → Import an existing project → pick the repo.
   Netlify reads `netlify.toml` automatically and picks up the functions.
3. In Site settings → Environment variables, add:
   - `QBO_CLIENT_ID`
   - `QBO_CLIENT_SECRET`
   - `QBO_REDIRECT_URI` — `https://<your-site>.netlify.app/.netlify/functions/qbo-auth-callback`
4. Get those three values by registering an app at
   [developer.intuit.com](https://developer.intuit.com) → My Apps →
   Create an app → Accounting. Start in **Sandbox** mode to test against
   a fake QuickBooks company before pointing at your real one.

## Connecting QuickBooks (one-time, per company)

Visit `https://<your-site>.netlify.app/.netlify/functions/qbo-auth-start`
while logged into the QuickBooks account as an admin. It redirects to
Intuit's consent screen, then back to `qbo-auth-callback`, which stores
the access/refresh tokens in Netlify Blobs (a small built-in key-value
store — no separate database to run).

## Functions in this backend

| Function | Purpose |
|---|---|
| `qbo-auth-start` | Redirects to Intuit's OAuth consent screen |
| `qbo-auth-callback` | Exchanges the auth code for tokens, stores them |
| `qbo-find-invoice` | `GET ?company=X&amount=Y` — returns open invoices matching a company name (and amount, if given) |
| `qbo-mark-paid` | `POST { invoiceId, customerId, amount }` — records a QuickBooks Payment against that invoice |
| `send-check-email` | `POST { filename, pdfBase64, subject, bodyText }` — emails the PDF to the records inbox |
| `contract-scanner` | Every 6 hours: scans SAM.gov for federal interpreting/translation notices (Government tab) |
| `contract-scanner-test` | "Scan SAM.gov now" button (add `?dryRun=true` to preview without saving) |
| `public-scan-scheduled` | Daily at 15:00 UTC: starts the public web search |
| `public-scan-start` | "Search the web now" button |
| `public-scan-background` | Runs the AI web search for public RFPs (Public tab), up to 15 minutes |
| `private-discover-scheduled` | Daily check at 15:30 UTC: refreshes company suggestions when due (right away if empty, then weekly) |
| `private-discover-start` | "Find more companies" button |
| `private-discover-background` | Runs the AI search for companies to pursue (Private tab priorities and suggestions) |
| `prospects-update` | Track, Not a fit, or Restore a suggested company |
| `private-lookup-start` | "Research how to register" / "Research company" buttons |
| `private-lookup-background` | Runs the AI research on one company's supplier registration (Private tab) |
| `companies-update` | Adds, updates, or removes tracked companies |
| `contracts-list` | Everything the contracts page shows |
| `contracts-update` | Changes an opportunity's status or notes |
| `sheets-push` | Sends rows to Google Sheets, one tab per list |

## Contracts page

**`https://effectiff-scanner.netlify.app/contracts.html`** — works on phone and desktop.

Three tabs:

- **Government.** Federal notices from SAM.gov under NAICS 541930 (Translation and Interpretation Services), checked every 6 hours. Free.
- **Public.** Open RFPs posted on the web by states, cities, courts, schools, universities, hospitals, nonprofits, and companies. Found by Claude with web search once a day. Paid (see costs below).
- **Private.** Big companies rarely post language-services contracts publicly; they buy from registered suppliers. The tab fills itself with companies to pursue, refreshed weekly by Claude with web search:
  - **Priorities**: companies with a current public buying signal (a posted RFP/RFI, an open supplier registration listing language services, a new or expanded language access program, expansion into multilingual markets, or hiring for language-access or localization roles). Each shows the signal and its source link.
  - **More suggestions**: strong-fit companies without a current signal (health systems, insurers, law firms, private universities, tech, pharma, large multilingual employers), each with a specific reason.

  Project managers act on each one: **Research how to register** (Claude finds the supplier portal, open vs. invitation-only registration, requirements, and supplier diversity program), **Track**, or **Not a fit** (never suggested again). Tracked companies get a status, follow-up date, and notes, and keep the reason they were suggested. Companies can also be added by hand, and there's a built-in guide to how supplier registration works.

On the Government and Public tabs, each opportunity can be marked Interested, Applied, or Dismissed, with notes. Select any set to **Export CSV** or **Send to Google Sheet**. Deadlines within 7 days are highlighted.

### How AI results are checked

AI web search can get things wrong, so the app guards against the common failures:

- Any link the AI returns that never appeared in its actual search results is thrown out: the whole listing for public RFPs, just the link for company research, and for company suggestions the company is demoted from priority to suggestion. The page reports how many.
- RFPs whose deadline has passed, and anything from SAM.gov (already covered by the Government tab), are dropped.
- Every AI-found item is labeled as such, with a reminder to confirm details at the source.

### Costs

Government tab: free (SAM.gov API).

Public and Private tabs use the Claude API (Anthropic). Pricing at the time of writing: Claude Sonnet 5.5 at $2 per million input tokens and $10 per million output tokens, plus $10 per 1,000 web searches. See https://platform.claude.com/docs/en/about-claude/pricing for current prices.

Estimates (real costs show on the page after each run):

| Use | Estimate |
|---|---|
| One public web search (up to 8 searches) | about $0.30–$0.60 |
| Daily public search for a month | about $9–$18 |
| One company-suggestion run (up to 10 searches) | about $0.40–$0.80 |
| Weekly company suggestions for a month | about $2–$4 |
| One company lookup (up to 5 searches) | about $0.15–$0.35 |

Built-in limits, all adjustable with environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `MONTHLY_AI_BUDGET_USD` | 25 | No new AI runs once the month's estimated spend reaches this |
| `MAX_PUBLIC_SCANS_PER_DAY` | 3 | Daily cap on web searches (scheduled + manual) |
| `MAX_LOOKUPS_PER_DAY` | 20 | Daily cap on company lookups |
| `MAX_DISCOVERIES_PER_DAY` | 2 | Daily cap on company-suggestion runs |
| `PRIVATE_DISCOVERY_INTERVAL_DAYS` | 7 | How often suggestions refresh automatically |
| `PRIVATE_DISCOVERY_FOCUS` | United States, extra attention to California | Where the company search looks |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | `claude-haiku-4-5` roughly halves the cost, with somewhat less careful filtering |
| `PUBLIC_SCAN_FOCUS` | United States, extra attention to California | Where the public search looks |

The spend total is an estimate from published prices. Also set a spend limit in the Claude Console as a second safety net.

### SAM.gov rate limit

SAM.gov allows roughly **10 requests per day** on a personal API key. The schedule uses 4; each "Scan SAM.gov now" uses 1 more. For more, apply for a SAM.gov system account.

### One-time setup

**1. SAM.gov key (Government tab).** Free at https://api.data.gov/signup/ — arrives by email.

**2. Anthropic API key (Public and Private tabs).** In the Claude Console (https://platform.claude.com), add a payment method, then create an API key. Needs company approval since it's a monthly bill.

**3. Netlify environment variables** (Site configuration → Environment variables):

| Variable | Needed for |
|---|---|
| `SAM_API_KEY` | Government tab |
| `ANTHROPIC_API_KEY` | Public and Private tabs |
| `CONTRACTS_PASSCODE` | Strongly recommended: without it, anyone with the URL could edit the lists or start paid searches (the daily and monthly limits still apply) |
| `GOOGLE_SHEET_WEBHOOK_URL` | Send to Google Sheet (step 4) |
| `SITE_URL` | Only if the daily web search doesn't start on its own: set to `https://effectiff-scanner.netlify.app` |

Then **Deploys → Trigger deploy**.

**4. Google Sheet (optional).** Open the sheet → Extensions → Apps Script → paste `google-sheet-script.gs` → Deploy → New deployment → Web app, "Execute as: Me", "Who has access: Anyone" → copy the URL into `GOOGLE_SHEET_WEBHOOK_URL`. Each list gets its own tab; re-sending an item updates its row. CSV export needs no setup.

**5. First run.** Open the page, enter the passcode (gear icon), then use **Scan SAM.gov now**, **Search the web now**, and **Find more companies**. (Company suggestions also start on their own within a day.)

### Troubleshooting

- **A web search, company search, or lookup stays "running."** Background functions do the AI work. Check Netlify → Logs → Functions → `public-scan-background`, `private-discover-background`, or `private-lookup-background`. After 16 minutes the page marks it failed.
- **"Web search isn't enabled."** An admin can turn it on in the Claude Console under Settings → Capabilities.
- **Blank agency names or links on the Government tab.** SAM.gov field names change occasionally. Visit `/.netlify/functions/contract-scanner-test?dryRun=true&passcode=YOUR_PASSCODE` and compare `sampleRaw` to `normalize()` in `_contract-scanner-core.js`.

### Tuning

- Government keywords, NAICS codes, and skipped notice types: top of `netlify/functions/_contract-scanner-core.js`.
- Public search wording: `buildPrompt()` in `netlify/functions/_public-scan-core.js`.
- Company suggestions (what counts as a buying signal, which industries): `buildPrompt()` in `netlify/functions/_private-discover-core.js`.
- Company research questions: `buildPrompt()` in `netlify/functions/_private-lookup-core.js`.

## Email copies to records

Every successful Rocket.Chat send also emails the batch PDF to
**assistant@effectiff.com** (override with the `RECORDS_EMAIL` env var).
For this to work, set these environment variables in Netlify:

- `SMTP_HOST` — your mail provider's SMTP server (e.g. `smtp.office365.com` for Microsoft 365, `smtp.gmail.com` for Google Workspace)
- `SMTP_PORT` — usually `587`
- `SMTP_USER` — the mailbox that sends (a dedicated one like `scanner@effectiff.com` is cleanest)
- `SMTP_PASS` — its password. For Microsoft 365 / Google Workspace you'll likely need an **app password**, since regular passwords are blocked for SMTP by default.

Until these are set, sends to Rocket.Chat still succeed — the app just
reports that the email copy failed.

## Roadmap

- [x] Phase 1 — capture, OCR, group, PDF, Rocket.Chat (web)
- [x] Phase 1 — same, native (iOS, Swift/SwiftUI)
- [ ] Phase 2 — wire `qbo-find-invoice` into the UI after a check is
      tagged with a company: show a "matches invoice #1234 — mark paid?"
      confirmation rather than auto-marking, since this touches real
      accounting records
- [ ] Phase 2 — call `qbo-mark-paid` after a successful Rocket.Chat send,
      once the person confirms the match
- [ ] Consider: what happens when OCR/company tagging is wrong and the
      wrong invoice gets matched — build the confirmation step before
      any auto-marking, not after
