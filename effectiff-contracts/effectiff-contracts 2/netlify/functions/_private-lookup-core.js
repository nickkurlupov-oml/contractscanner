// AI research on how to become a supplier to a specific private company.

import { openStore, readJson, writeJson, KEYS } from './_store.js';
import { searchWithClaude, linkCheck } from './_ai.js';
import { checkBudget, countRun, addCost } from './_budget.js';

const MAX_SEARCHES = Number(process.env.LOOKUP_MAX_SEARCHES || 5);
const STALE_MS = 16 * 60 * 1000;

const SYSTEM = `You research supplier registration for Effectiff, a small US language services company offering interpretation (on-site, video, phone, ASL) and document translation.
Report only what your search results support. Never invent URLs, program names, or requirements. Prefer the company's own website. Do not include personal contact details of individual employees; general procurement or supplier-diversity inboxes published on the company's own site are fine.`;

function buildPrompt(company){
  const today = new Date().toISOString().slice(0, 10);
  return `Today is ${today}.

Research how a small US language services company can become a supplier to ${company}. Find:
- the official supplier or vendor registration/onboarding page
- whether registration is open to anyone or requires a sponsoring buyer (invitation only)
- the procurement platform they use, if stated (for example SAP Ariba, Coupa, Jaggaer)
- their supplier diversity program, if any, and which certifications it recognizes
- typical requirements for new suppliers (documents, insurance, certifications)
- any published information on which teams buy language, localization, or translation services

Use at most ${MAX_SEARCHES} searches. End your reply with one JSON code block and nothing after it:

\`\`\`json
{"company":"...","portalName":"... or null","portalUrl":"https://... or null","registration":"open|invitation_only|unclear","platform":"... or null","steps":["..."],"requirements":["..."],"diversityProgram":{"name":"... or null","url":"https://... or null","certifications":["..."]},"languageServicesBuyers":"... or null","tips":["..."],"sources":[{"title":"...","url":"https://..."}]}
\`\`\`

Use null or empty lists for anything you couldn't find.`;
}

function clean(v, max = 400){
  if(v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.toLowerCase() === 'null' ? '' : s.slice(0, max);
}
function cleanList(v, maxItems = 10){
  return Array.isArray(v) ? v.map(x => clean(x)).filter(Boolean).slice(0, maxItems) : [];
}

async function updateCompany(store, id, patch){
  const list = await readJson(store, KEYS.companies, []);
  const i = list.findIndex(c => c.id === id);
  if(i === -1) return null;
  list[i] = { ...list[i], ...patch };
  await writeJson(store, KEYS.companies, list);
  return list[i];
}

async function runLookup(event, id){
  const store = openStore(event);
  const companies = await readJson(store, KEYS.companies, []);
  const company = companies.find(c => c.id === id);
  if(!company) return;

  const gate = await checkBudget(store, 'lookups');
  if(!gate.ok){
    await updateCompany(store, id, { lookupStatus: 'error', lookupError: gate.reason });
    return;
  }
  await countRun(store, 'lookups');
  await updateCompany(store, id, { lookupStatus: 'running', lookupStartedAt: new Date().toISOString(), lookupError: null });

  try{
    const result = await searchWithClaude({ system: SYSTEM, prompt: buildPrompt(company.name), maxSearches: MAX_SEARCHES });
    await addCost(store, 'lookups', result.cost.usd);
    const j = result.json;
    if(!j){
      await updateCompany(store, id, { lookupStatus: 'error', lookupError: "The research finished, but its results couldn't be read. Try again.", lookupCostUsd: result.cost.usd });
      return;
    }

    // Keep only links that actually appeared in search results.
    const keepUrl = (u) => { const url = clean(u, 1000); return url && linkCheck(url, result.found) ? url : ''; };
    const div = j.diversityProgram || {};
    const lookup = {
      portalName: clean(j.portalName),
      portalUrl: keepUrl(j.portalUrl),
      registration: ['open', 'invitation_only', 'unclear'].includes(j.registration) ? j.registration : 'unclear',
      platform: clean(j.platform, 80),
      steps: cleanList(j.steps, 12),
      requirements: cleanList(j.requirements, 12),
      diversityProgram: {
        name: clean(div.name),
        url: keepUrl(div.url),
        certifications: cleanList(div.certifications, 10)
      },
      languageServicesBuyers: clean(j.languageServicesBuyers, 500),
      tips: cleanList(j.tips, 8),
      sources: (Array.isArray(j.sources) ? j.sources : [])
        .map(s => ({ title: clean(s && s.title, 200), url: keepUrl(s && s.url) }))
        .filter(s => s.url).slice(0, 8)
    };
    await updateCompany(store, id, {
      lookup,
      lookupStatus: 'done',
      lookupAt: new Date().toISOString(),
      lookupCostUsd: result.cost.usd,
      lookupError: null
    });
  }catch(err){
    await updateCompany(store, id, { lookupStatus: 'error', lookupError: err.message });
  }
}

export { runLookup, updateCompany, STALE_MS };
