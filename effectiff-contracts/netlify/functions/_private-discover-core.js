// AI discovery of private-sector companies to pursue as a supplier.
//
// Produces two tiers:
//   priority   — a current public buying signal was found, with a source
//                link that appeared in the actual search results
//   suggestion — a strong fit without a current signal (or whose signal
//                link couldn't be confirmed)
//
// Results accumulate across runs. Companies already tracked or marked
// "Not a fit" are never suggested again.

const { openStore, readJson, writeJson, KEYS } = require('./_store');
const { searchWithClaude, linkCheck } = require('./_ai');
const { checkBudget, countRun, addCost } = require('./_budget');
const crypto = require('crypto');

const MAX_SEARCHES = Number(process.env.PRIVATE_DISCOVERY_MAX_SEARCHES || 10);
const INTERVAL_DAYS = Number(process.env.PRIVATE_DISCOVERY_INTERVAL_DAYS || 7);
const MAX_STORED = 300;
const STALE_MS = 16 * 60 * 1000;

const SYSTEM = `You find sales prospects for Effectiff, a US language services company offering on-site, video, and phone interpretation, American Sign Language (ASL) interpreting, and document translation. Effectiff serves healthcare, education, and legal clients nationwide.
Only report buying signals that appear in your search results, and give the URL of the page showing each one. Never invent URLs, dates, or signals. Suggestions without a current signal are fine, but give a specific, factual reason for each.`;

// "Meta Platforms, Inc." and "meta platforms" match; so do "The Kaiser Foundation" and "Kaiser Foundation".
function normalizeName(n){
  return String(n || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|inc|incorporated|llc|llp|ltd|corp|corporation|co|company|plc|group|holdings)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function buildPrompt(exclude){
  const today = new Date().toISOString().slice(0, 10);
  const focus = process.env.PRIVATE_DISCOVERY_FOCUS || 'the United States, with extra attention to California';
  return `Today is ${today}.

Find private-sector organizations in ${focus} that are likely buyers of interpretation and translation services.

Part 1, priorities: organizations with a current, public buying signal in your search results, such as:
- a posted RFP, RFI, or RFQ for interpretation, translation, or language access services from a private organization
- a supplier or vendor registration page that is open and lists translation, interpreting, or language services
- a recent announcement of a new or expanded language access program, or new facilities or services in multilingual communities
- expansion into new language markets or countries
- job postings for language access, interpreter services, or localization program managers (a sign a program is being built)

Part 2, suggestions: other organizations that are a strong fit even without a current signal. Consider health systems and medical groups, health plans and insurers, law firms with large litigation or immigration practices, private universities, banks and insurers with multilingual customers, technology companies with large localization needs, pharmaceutical and clinical research companies, and large employers with multilingual workforces. Name specific organizations, not categories.

Exclude government agencies and public schools (tracked separately).
${exclude.length ? `Also exclude these organizations, already on file:\n${exclude.join('; ')}\n` : ''}
Use at most ${MAX_SEARCHES} searches. Return up to 10 priorities and 25 suggestions. End your reply with one JSON code block and nothing after it:

\`\`\`json
{"priorities":[{"name":"...","industry":"...","location":"City, ST or national","signal":"One sentence on what you found.","signalUrl":"https://...","signalDate":"YYYY-MM-DD or null","why":"One sentence on why they fit."}],
 "suggestions":[{"name":"...","industry":"...","location":"City, ST or national","why":"One specific sentence on why they fit."}]}
\`\`\``;
}

function clean(v, max = 300){
  if(v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.toLowerCase() === 'null' ? '' : s.slice(0, max);
}

async function setStatus(store, patch){
  const cur = await readJson(store, KEYS.discoverStatus, {});
  await writeJson(store, KEYS.discoverStatus, { ...cur, ...patch });
}

async function canStart(store){
  const st = await readJson(store, KEYS.discoverStatus, {});
  const busy = (st.state === 'queued' || st.state === 'running') && st.startedAt && (Date.now() - new Date(st.startedAt).getTime() < STALE_MS);
  if(busy) return { ok: false, reason: 'Already looking for companies. New suggestions appear here when it finishes.' };
  return checkBudget(store, 'discoveries');
}

// Used by the daily scheduler: run if there are no suggestions yet, or the
// last successful run is older than the interval.
async function isDue(store){
  const [st, prospects] = await Promise.all([readJson(store, KEYS.discoverStatus, {}), readJson(store, KEYS.prospects, [])]);
  if(!prospects.some(p => p.state === 'open')) return true;
  if(!st.lastSuccessAt) return true;
  return Date.now() - new Date(st.lastSuccessAt).getTime() > INTERVAL_DAYS * 86400000;
}

async function runDiscovery(event, trigger){
  const store = openStore(event);
  const gate = await checkBudget(store, 'discoveries');
  if(!gate.ok){
    await setStatus(store, { state: 'error', error: gate.reason, finishedAt: new Date().toISOString() });
    return;
  }
  await countRun(store, 'discoveries');
  await setStatus(store, { state: 'running', startedAt: new Date().toISOString(), trigger, error: null });

  try{
    const [prospects, companies] = await Promise.all([readJson(store, KEYS.prospects, []), readJson(store, KEYS.companies, [])]);
    // Tell the AI what to skip: tracked, dismissed, and existing priorities.
    // Existing *suggestions* are left off so they can be upgraded if a signal appears.
    const exclude = [
      ...companies.map(c => c.name),
      ...prospects.filter(p => p.state !== 'open' || p.tier === 'priority').map(p => p.name)
    ].slice(0, 150);

    const result = await searchWithClaude({ system: SYSTEM, prompt: buildPrompt(exclude), maxSearches: MAX_SEARCHES, maxTokens: 8000 });
    await addCost(store, 'discoveries', result.cost.usd);

    const j = result.json;
    if(!j || (!Array.isArray(j.priorities) && !Array.isArray(j.suggestions))){
      await setStatus(store, { state: 'error', error: "The search finished, but its results couldn't be read. Try again later.", finishedAt: new Date().toISOString(), costUsd: result.cost.usd });
      return;
    }

    const now = new Date().toISOString();
    let demoted = 0;
    const incoming = [];
    (Array.isArray(j.priorities) ? j.priorities : []).forEach(p => {
      const name = clean(p.name, 120); if(!name) return;
      const url = clean(p.signalUrl, 1000);
      const check = /^https?:\/\//i.test(url) ? linkCheck(url, result.found) : null;
      const base = { name, industry: clean(p.industry, 80), location: clean(p.location, 80), why: clean(p.why, 400) };
      if(check && clean(p.signal)){
        incoming.push({ ...base, tier: 'priority', signal: clean(p.signal, 400), signalUrl: url, signalDate: clean(p.signalDate, 20), linkCheck: check });
      } else {
        demoted++;
        incoming.push({ ...base, tier: 'suggestion' });
      }
    });
    (Array.isArray(j.suggestions) ? j.suggestions : []).forEach(p => {
      const name = clean(p.name, 120); if(!name) return;
      incoming.push({ name, industry: clean(p.industry, 80), location: clean(p.location, 80), why: clean(p.why, 400), tier: 'suggestion' });
    });

    // Merge against the latest saved list (re-read in case someone acted meanwhile).
    const [latest, latestCompanies] = await Promise.all([readJson(store, KEYS.prospects, []), readJson(store, KEYS.companies, [])]);
    const tracked = new Set(latestCompanies.map(c => normalizeName(c.name)));
    const byName = new Map(latest.map(p => [normalizeName(p.name), p]));
    let addedPriorities = 0, addedSuggestions = 0, upgraded = 0;

    for(const item of incoming){
      const key = normalizeName(item.name);
      if(!key || tracked.has(key)) continue;
      const existing = byName.get(key);
      if(existing){
        // Only open suggestions can change: upgrade to priority if a verified signal appeared.
        if(existing.state === 'open' && existing.tier === 'suggestion' && item.tier === 'priority'){
          Object.assign(existing, { tier: 'priority', signal: item.signal, signalUrl: item.signalUrl, signalDate: item.signalDate, linkCheck: item.linkCheck, why: item.why || existing.why, updatedAt: now });
          upgraded++;
        }
        continue;
      }
      const rec = { id: 'pr-' + crypto.randomBytes(6).toString('hex'), ...item, state: 'open', foundAt: now };
      byName.set(key, rec);
      latest.unshift(rec);
      item.tier === 'priority' ? addedPriorities++ : addedSuggestions++;
    }

    // Cap size: drop the oldest open suggestions first; keep dismissed
    // records so those companies aren't suggested again.
    let list = latest;
    if(list.length > MAX_STORED){
      const openSugg = list.filter(p => p.state === 'open' && p.tier === 'suggestion');
      const drop = new Set(openSugg.slice(-(list.length - MAX_STORED)).map(p => p.id));
      list = list.filter(p => !drop.has(p.id)).slice(0, MAX_STORED);
    }
    await writeJson(store, KEYS.prospects, list);

    await setStatus(store, {
      state: 'done', finishedAt: now, lastSuccessAt: now,
      addedPriorities, addedSuggestions, upgraded, demoted,
      costUsd: result.cost.usd, searches: result.cost.searches, error: null
    });
  }catch(err){
    await setStatus(store, { state: 'error', error: err.message, finishedAt: new Date().toISOString() });
  }
}

module.exports = { runDiscovery, canStart, isDue, setStatus, normalizeName, STALE_MS };
