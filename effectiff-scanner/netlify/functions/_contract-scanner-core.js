// Core logic for the contract opportunity scanner. Shared by:
//   - contract-scanner.js       (runs automatically on a schedule)
//   - contract-scanner-test.js  (manual trigger, for setup/debugging)
//
// What it does: queries SAM.gov's public opportunities API for postings
// under the relevant NAICS code(s), drops non-biddable notice types (awards
// etc.), optionally requires a keyword in the title, and saves anything new
// into the app's own list (Netlify Blobs) where the contracts page shows it.
// Optionally also posts to a Rocket.Chat room if RC_CONTRACTS_ROOM_ID is set.
//
// RATE LIMIT — READ THIS: SAM.gov allows roughly 10 requests/day on a
// personal (non-federal) API key. Every scan = 1 request, and so does every
// visit to the manual test endpoint. The schedule is set to 4 runs/day to
// leave room for testing. If you need more, SAM.gov offers higher limits
// for registered "system accounts" — see the README.
//
// FIELD NAMES: SAM.gov's response fields have shifted between API versions
// and this was written without a live key to test against. If entries show
// up with blank agency/links, compare the raw output from the dry-run test
// endpoint against the lookups in normalize() and adjust — nothing else
// should need to change.

const { openStore, readJson: readStoreJson, writeJson, KEYS } = require('./_store');

// NAICS 541930 = Translation and Interpretation Services.
const NAICS_CODES = ['541930'];

// Optional secondary filter on the title. The NAICS code already does most
// of the narrowing, so this is deliberately broad. Set REQUIRE_KEYWORD to
// false to keep everything under the NAICS code(s) regardless of title.
const REQUIRE_KEYWORD = true;
const KEYWORDS = [
  'interpret', 'translat', 'language', 'linguist', 'bilingual',
  'asl', 'sign language', 'transcri', 'localization', 'localisation'
];

// Notice types that are NOT opportunities to bid on.
const SKIP_TYPES = ['award', 'justification', 'surplus', 'intent to bundle'];

const MAX_STORED = 1000;        // keep the list from growing forever
const MAX_RC_POSTS_PER_RUN = 15; // only matters if Rocket.Chat posting is on
const LOOKBACK_DAYS = 4;         // overlap window across runs; dedupe handles repeats

const LIST_KEY = KEYS.government;
const SEEN_KEY = KEYS.governmentSeen;
const META_KEY = KEYS.governmentMeta;

function fmtQueryDate(d){
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

async function fetchOpportunities(){
  const apiKey = process.env.SAM_API_KEY;
  if(!apiKey){
    throw new Error('SAM_API_KEY is not set in Netlify environment variables.');
  }

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - LOOKBACK_DAYS);

  const all = [];
  for(const naics of NAICS_CODES){
    const params = new URLSearchParams({
      api_key: apiKey,
      postedFrom: fmtQueryDate(from),
      postedTo: fmtQueryDate(today),
      ncode: naics,
      limit: '500'
    });
    const res = await fetch(`https://api.sam.gov/opportunities/v2/search?${params}`);

    if(res.status === 429){
      throw new Error('SAM.gov rate limit reached for today (personal keys allow ~10 requests/day). The scan will resume automatically tomorrow; avoid extra manual test runs.');
    }
    if(res.status === 403 || res.status === 401){
      throw new Error(`SAM.gov rejected the API key (${res.status}). Check SAM_API_KEY in Netlify — and note new keys can take a few minutes to activate.`);
    }
    if(!res.ok){
      const body = await res.text().catch(() => '');
      throw new Error(`SAM.gov query failed for NAICS ${naics}: ${res.status} ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    const list = data.opportunitiesData || data.data || [];
    all.push(...list);
  }
  return all;
}

function isBiddable(opp){
  const type = String(opp.type || opp.baseType || '').toLowerCase();
  if(SKIP_TYPES.some(t => type.includes(t))) return false;
  if(opp.active !== undefined && String(opp.active).toLowerCase() === 'no') return false;
  return true;
}

function matchesKeyword(opp){
  if(!REQUIRE_KEYWORD) return true;
  const haystack = (opp.title || '').toLowerCase();
  return KEYWORDS.some(k => haystack.includes(k));
}

// Turn a raw SAM.gov record into the compact shape the contracts page uses.
function normalize(opp){
  const id = opp.noticeId || opp.solicitationNumber || '';
  const pop = opp.placeOfPerformance || {};
  const place = (pop.state && (pop.state.name || pop.state.code)) || (pop.city && pop.city.name) || '';
  return {
    id,
    source: 'government',
    title: opp.title || 'Untitled opportunity',
    agency: opp.fullParentPathName || opp.organizationName || opp.department || 'Unknown agency',
    type: opp.type || opp.baseType || 'Notice',
    postedDate: opp.postedDate || '',
    responseDeadline: opp.responseDeadLine || opp.responseDate || '',
    setAside: opp.typeOfSetAsideDescription || opp.typeOfSetAside || '',
    place,
    solicitationNumber: opp.solicitationNumber || '',
    naics: opp.naicsCode || NAICS_CODES.join(', '),
    link: opp.uiLink || (id ? `https://sam.gov/opp/${id}/view` : ''),
    foundAt: new Date().toISOString(),
    status: 'new',   // new | interested | applied | dismissed
    notes: ''
  };
}

function fmtHumanDate(value){
  if(!value) return 'Not specified';
  const d = new Date(value);
  if(isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRocketChatMessage(rec){
  const lines = [
    `**${rec.type}: ${rec.title}**`,
    `Agency: ${rec.agency}`,
    `Response due: ${fmtHumanDate(rec.responseDeadline)}  |  Posted: ${fmtHumanDate(rec.postedDate)}`
  ];
  if(rec.setAside) lines.push(`Set-aside: ${rec.setAside}`);
  if(rec.place) lines.push(`Place of performance: ${rec.place}`);
  if(rec.solicitationNumber) lines.push(`Solicitation #: ${rec.solicitationNumber}`);
  if(rec.link) lines.push(rec.link);
  return lines.join('\n');
}

// Optional: only used when RC_CONTRACTS_ROOM_ID is set.
async function postToRocketChat(message){
  const server = process.env.RC_SERVER;
  const userId = process.env.RC_USER_ID;
  const token = process.env.RC_AUTH_TOKEN;
  const roomId = process.env.RC_CONTRACTS_ROOM_ID;
  if(!server || !userId || !token || !roomId){
    throw new Error('Rocket.Chat posting is on (RC_CONTRACTS_ROOM_ID is set) but RC_SERVER, RC_USER_ID, or RC_AUTH_TOKEN is missing.');
  }
  const res = await fetch(`${server.replace(/\/$/, '')}/api/v1/chat.postMessage`, {
    method: 'POST',
    headers: { 'X-Auth-Token': token, 'X-User-Id': userId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId, text: message })
  });
  if(!res.ok){
    const body = await res.text().catch(() => '');
    throw new Error(`Rocket.Chat post failed: ${res.status} ${body.slice(0, 300)}`);
  }
}

// dryRun=true fetches and evaluates everything but saves nothing and posts
// nothing. (It still costs one SAM.gov request against the daily limit.)
async function runScan({ dryRun = false, event } = {}){
  const store = openStore(event);
  const existing = await readStoreJson(store, LIST_KEY, []);
  const seen = new Set(await readStoreJson(store, SEEN_KEY, []));
  existing.forEach(r => seen.add(r.id));

  const opportunities = await fetchOpportunities();

  const fresh = [];
  const skipped = { alreadySeen: 0, notBiddable: [], noKeywordMatch: [] };

  for(const opp of opportunities){
    const id = opp.noticeId || opp.solicitationNumber;
    if(!id) continue;
    if(seen.has(id)){ skipped.alreadySeen++; continue; }

    if(!isBiddable(opp)){
      skipped.notBiddable.push(opp.title || id);
      if(!dryRun) seen.add(id);
      continue;
    }
    if(!matchesKeyword(opp)){
      skipped.noKeywordMatch.push(opp.title || id);
      if(!dryRun) seen.add(id);
      continue;
    }
    fresh.push(normalize(opp));
    seen.add(id);
  }

  let rcPosted = 0;
  let rcFailed = [];

  if(!dryRun){
    // Save new findings at the top of the list; trim the oldest beyond the cap.
    // Re-read first so status/notes edits made during the scan aren't lost.
    const latest = await readStoreJson(store, LIST_KEY, []);
    const latestIds = new Set(latest.map(r => r.id));
    const updated = [...fresh.filter(r => !latestIds.has(r.id)), ...latest].slice(0, MAX_STORED);
    await writeJson(store, LIST_KEY, updated);
    // Track filtered-out ids separately so they aren't re-evaluated each run.
    const listIds = new Set(updated.map(r => r.id));
    await writeJson(store, SEEN_KEY, Array.from(seen).filter(id => !listIds.has(id)).slice(-2000));
    await writeJson(store, META_KEY, { lastScanAt: new Date().toISOString(), lastFetched: opportunities.length, lastNew: fresh.length });

    // Optional Rocket.Chat notifications.
    if(process.env.RC_CONTRACTS_ROOM_ID){
      const batch = fresh.slice(0, MAX_RC_POSTS_PER_RUN);
      const results = await Promise.allSettled(batch.map(r => postToRocketChat(formatRocketChatMessage(r))));
      results.forEach((r, i) => {
        if(r.status === 'fulfilled') rcPosted++;
        else rcFailed.push({ title: batch[i].title, error: String((r.reason && r.reason.message) || r.reason) });
      });
    }
  }

  return {
    dryRun,
    totalFetched: opportunities.length,
    [dryRun ? 'wouldAdd' : 'added']: fresh.map(r => r.title),
    rocketChat: process.env.RC_CONTRACTS_ROOM_ID ? { posted: rcPosted, failed: rcFailed.length ? rcFailed : undefined } : 'off',
    skipped,
    // In dry-run mode, include one full raw record so field names can be
    // checked against normalize() if anything looks off.
    sampleRaw: dryRun ? (opportunities[0] || null) : undefined
  };
}

module.exports = { runScan };
