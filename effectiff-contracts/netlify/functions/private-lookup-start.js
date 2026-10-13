// POST { name } | { id } | { prospectId } → adds the company to the tracker if
// needed (moving a suggestion into the tracker) and starts researching it in
// the background.

const { checkPasscode, json } = require('./_contracts-auth');
const { openStore, readJson, writeJson, KEYS } = require('./_store');
const { checkBudget } = require('./_budget');
const { STALE_MS } = require('./_private-lookup-core');
const { triggerBackground } = require('./_trigger');
const { normalizeName } = require('./_private-discover-core');
const { trackProspect } = require('./prospects-update');
const crypto = require('crypto');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const denied = checkPasscode(event);
  if(denied) return denied;
  if(!process.env.ANTHROPIC_API_KEY){
    return json(400, { error: 'Company research isn\'t set up yet — add ANTHROPIC_API_KEY in Netlify environment variables.' });
  }

  let payload;
  try{ payload = JSON.parse(event.body || '{}'); }catch{ return json(400, { error: 'Invalid JSON body.' }); }

  try{
    const store = openStore(event);
    if(payload.prospectId){
      const r = await trackProspect(store, payload.prospectId);
      if(r.error) return json(404, r);
      payload.id = r.company.id;
    }
    const list = await readJson(store, KEYS.companies, []);
    let company = payload.id ? list.find(c => c.id === payload.id) : null;

    if(!company){
      const name = String(payload.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if(!name) return json(400, { error: 'Enter a company name.' });
      company = list.find(c => normalizeName(c.name) === normalizeName(name));
      if(!company){
        company = { id: 'co-' + crypto.randomBytes(6).toString('hex'), name, status: 'not_started', notes: '', followUp: '', createdAt: new Date().toISOString(), lookup: null, lookupStatus: 'none' };
        list.unshift(company);
      }
    }

    const busy = (company.lookupStatus === 'queued' || company.lookupStatus === 'running') && company.lookupStartedAt && (Date.now() - new Date(company.lookupStartedAt).getTime() < STALE_MS);
    if(busy) return json(409, { error: `${company.name} is already being researched.` });

    const gate = await checkBudget(store, 'lookups');
    if(!gate.ok){ await writeJson(store, KEYS.companies, list); return json(429, { error: gate.reason, company }); }

    company.lookupStatus = 'queued';
    company.lookupStartedAt = new Date().toISOString();
    company.lookupError = null;
    await writeJson(store, KEYS.companies, list);
    await markSuggestionTracked(store, company.name);

    await triggerBackground(event, 'private-lookup-background', { id: company.id });
    return json(202, { started: true, company });
  }catch(err){
    return json(500, { error: err.message });
  }
};

// If someone researches a company by name that's also in the suggestions,
// move that suggestion out of the list.
async function markSuggestionTracked(store, name){
  const prospects = await readJson(store, KEYS.prospects, []);
  const p = prospects.find(x => x.state === 'open' && normalizeName(x.name) === normalizeName(name));
  if(!p) return;
  p.state = 'tracked'; p.updatedAt = new Date().toISOString();
  await writeJson(store, KEYS.prospects, prospects);
}
