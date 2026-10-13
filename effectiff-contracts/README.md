# Effectiff Contracts

Finds contract opportunities for Effectiff's language services and tracks them for the bids team: federal notices from SAM.gov, public RFPs found by AI web search, and private companies to pursue as a supplier.

This is a separate project from the Effectiff check scanner (`effectiff-scanner.netlify.app`). They share no code or settings, so changes here can't affect the scanner.

## Deploying

1. Upload the contents of this folder to the GitHub repo (keep the `netlify/functions/` folder structure).
2. Connect the repo to the Netlify site. Netlify reads `netlify.toml` and installs the dependencies in `package.json` automatically; there's no build command.
3. Add the environment variables listed under One-time setup below, then **Deploys → Trigger deploy**.

## What it does

**https://effectiffcontracts.netlify.app** — works on phone and desktop.

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
| `SITE_URL` | Only if the daily web search doesn't start on its own: set to `https://effectiffcontracts.netlify.app` |

Then **Deploys → Trigger deploy**.

**4. Google Sheet (optional).** Open the sheet → Extensions → Apps Script → paste `google-sheet-script.gs` → Deploy → New deployment → Web app, "Execute as: Me", "Who has access: Anyone" → copy the URL into `GOOGLE_SHEET_WEBHOOK_URL`. Each list gets its own tab; re-sending an item updates its row. CSV export needs no setup.

**5. First run.** Open https://effectiffcontracts.netlify.app, enter the passcode (gear icon), then use **Scan SAM.gov now**, **Search the web now**, and **Find more companies**. (Company suggestions also start on their own within a day.)

### Troubleshooting

- **A web search, company search, or lookup stays "running."** Background functions do the AI work. Check Netlify → Logs → Functions → `public-scan-background`, `private-discover-background`, or `private-lookup-background`. After 16 minutes the page marks it failed.
- **"Web search isn't enabled."** An admin can turn it on in the Claude Console under Settings → Capabilities.
- **Blank agency names or links on the Government tab.** SAM.gov field names change occasionally. Visit `https://effectiffcontracts.netlify.app/.netlify/functions/contract-scanner-test?dryRun=true&passcode=YOUR_PASSCODE` and compare `sampleRaw` to `normalize()` in `_contract-scanner-core.js`.

### Tuning

- Government keywords, NAICS codes, and skipped notice types: top of `netlify/functions/_contract-scanner-core.js`.
- Public search wording: `buildPrompt()` in `netlify/functions/_public-scan-core.js`.
- Company suggestions (what counts as a buying signal, which industries): `buildPrompt()` in `netlify/functions/_private-discover-core.js`.
- Company research questions: `buildPrompt()` in `netlify/functions/_private-lookup-core.js`.

## Functions

| Function | Purpose |
|---|---|
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
