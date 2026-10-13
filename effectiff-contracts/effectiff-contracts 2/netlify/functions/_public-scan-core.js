// AI web search for publicly posted (non-federal) solicitations:
// state/local government, courts, schools, universities, hospitals,
// nonprofits, and private companies that post RFPs openly.

import { openStore, readJson, writeJson, KEYS } from './_store.js';
import { searchWithClaude, linkCheck, normalizeUrl } from './_ai.js';
import { checkBudget, countRun, addCost } from './_budget.js';

const MAX_SEARCHES = Number(process.env.PUBLIC_SCAN_MAX_SEARCHES || 8);
const MAX_STORED = 500;
const STALE_MS = 16 * 60 * 1000; // background functions stop at 15 minutes

const SYSTEM = `You research open solicitations for Effectiff, a US language services company offering on-site, video, and phone interpretation, document translation, and American Sign Language (ASL) interpreting.
Report only real solicitations that appear in your search results. Never invent titles, organizations, dates, or URLs. For each one, give the URL of the page where you found it. If a detail is not in the results, use null.`;

function buildPrompt(existing){
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const focus = process.env.PUBLIC_SCAN_FOCUS || 'the United States, with extra attention to California';
  const known = existing.slice(0, 40).map(o => `- ${o.title} (${o.organization})`).join('\n');
  return `Today is ${today}.

Search for currently open requests for proposals (RFP), requests for quotes (RFQ), invitations to bid (IFB/ITB), and requests for information (RFI) for interpretation, translation, language access, or ASL services. Focus on ${focus}.

Include buyers such as state and local governments, courts, school districts, universities, hospitals and health systems, transit agencies, nonprofits, and private companies.

Exclude:
- US federal notices from SAM.gov (tracked separately)
- job postings for individual interpreters or translators
- awarded, cancelled, or closed solicitations (response deadline before ${today})
- directory or aggregator pages that don't describe one specific solicitation

Suggested searches (adapt as needed):
- "RFP interpretation services ${year}"
- "request for proposals language access services"
- "translation services RFP due ${year}"
- "ASL interpreting services bid"
- "on-site interpreting services RFQ county"

${known ? `These are already on file; skip them:\n${known}\n` : ''}
Use at most ${MAX_SEARCHES} searches. End your reply with one JSON code block and nothing after it:

\`\`\`json
{"opportunities":[{"title":"...","organization":"...","organizationType":"state|county|city|court|school|university|healthcare|transit|nonprofit|private|other","location":"City, ST","responseDeadline":"YYYY-MM-DD or null","postedDate":"YYYY-MM-DD or null","solicitationNumber":"... or null","url":"https://...","summary":"One sentence on the scope."}]}
\`\`\`

Return {"opportunities":[]} if nothing qualifies.`;
}

function clean(v, max = 300){
  if(v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.toLowerCase() === 'null' ? '' : s.slice(0, max);
}

function isPast(dateStr){
  if(!dateStr) return false;
  const d = new Date(dateStr);
  if(isNaN(d)) return false;
  return d.getTime() < Date.now() - 24 * 3600 * 1000;
}

async function setStatus(store, patch){
  const cur = await readJson(store, KEYS.publicStatus, {});
  await writeJson(store, KEYS.publicStatus, { ...cur, ...patch });
}

// Called by public-scan-start and public-scan-scheduled before triggering.
async function canStart(store){
  const st = await readJson(store, KEYS.publicStatus, {});
  const busy = (st.state === 'queued' || st.state === 'running') && st.startedAt && (Date.now() - new Date(st.startedAt).getTime() < STALE_MS);
  if(busy) return { ok: false, reason: 'A web search is already running. Results will appear here when it finishes.' };
  return checkBudget(store, 'publicScans');
}

async function runPublicScan(event, trigger){
  const store = openStore(event);
  const gate = await checkBudget(store, 'publicScans');
  if(!gate.ok){
    await setStatus(store, { state: 'error', error: gate.reason, finishedAt: new Date().toISOString() });
    return;
  }
  await countRun(store, 'publicScans');
  await setStatus(store, { state: 'running', startedAt: new Date().toISOString(), trigger, error: null });

  try{
    const before = await readJson(store, KEYS.public, []);
    const result = await searchWithClaude({ system: SYSTEM, prompt: buildPrompt(before), maxSearches: MAX_SEARCHES });
    await addCost(store, 'publicScans', result.cost.usd);

    if(!result.json || !Array.isArray(result.json.opportunities)){
      await setStatus(store, { state: 'error', error: "The search finished, but its results couldn't be read. Try again later.", finishedAt: new Date().toISOString(), costUsd: result.cost.usd, searches: result.cost.searches });
      return;
    }

    let dropped = 0, expired = 0;
    const now = new Date().toISOString();
    const candidates = [];
    for(const raw of result.json.opportunities){
      const url = clean(raw.url, 1000);
      const title = clean(raw.title);
      if(!title || !/^https?:\/\//i.test(url)){ dropped++; continue; }
      if(/(^|\.)sam\.gov$/i.test((() => { try{ return new URL(url).host; }catch{ return ''; } })())){ dropped++; continue; }
      const check = linkCheck(url, result.found);
      if(!check){ dropped++; continue; }           // link never appeared in search results → likely made up
      const deadline = clean(raw.responseDeadline, 40);
      if(isPast(deadline)){ expired++; continue; }
      candidates.push({
        id: 'web-' + Buffer.from(normalizeUrl(url)).toString('base64url').slice(0, 40),
        source: 'public',
        title,
        organization: clean(raw.organization) || 'Unknown organization',
        organizationType: clean(raw.organizationType, 40) || 'other',
        location: clean(raw.location, 120),
        responseDeadline: deadline,
        postedDate: clean(raw.postedDate, 40),
        solicitationNumber: clean(raw.solicitationNumber, 120),
        summary: clean(raw.summary, 500),
        link: url,
        linkCheck: check,
        foundAt: now,
        status: 'new',
        notes: ''
      });
    }

    // Re-read right before writing so status/notes edits made during the
    // search aren't overwritten.
    const latest = await readJson(store, KEYS.public, []);
    const seenUrls = new Set(latest.map(o => normalizeUrl(o.link)));
    const seenKeys = new Set(latest.map(o => `${o.title}|${o.organization}`.toLowerCase()));
    const fresh = candidates.filter(c => {
      const k = `${c.title}|${c.organization}`.toLowerCase();
      if(seenUrls.has(normalizeUrl(c.link)) || seenKeys.has(k)) return false;
      seenUrls.add(normalizeUrl(c.link)); seenKeys.add(k);
      return true;
    });
    await writeJson(store, KEYS.public, [...fresh, ...latest].slice(0, MAX_STORED));

    await setStatus(store, {
      state: 'done',
      finishedAt: new Date().toISOString(),
      found: result.json.opportunities.length,
      added: fresh.length,
      dropped,
      expired,
      costUsd: result.cost.usd,
      searches: result.cost.searches,
      model: result.model,
      error: null
    });
  }catch(err){
    await setStatus(store, { state: 'error', error: err.message, finishedAt: new Date().toISOString() });
  }
}

export { runPublicScan, canStart, setStatus, STALE_MS };
