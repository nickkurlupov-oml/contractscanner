// POST { action: 'track' | 'dismiss' | 'restore', id }
//   track   — adds the company to the tracker (without research)
//   dismiss — "Not a fit": hides it and keeps it from being suggested again
//   restore — undoes dismiss

import { v2 } from './_http.js';
import { checkPasscode, json } from './_contracts-auth.js';
import { openStore, readJson, writeJson, KEYS } from './_store.js';
import { normalizeName } from './_private-discover-core.js';
import crypto from 'crypto';

function originOf(p){
  return { tier: p.tier, why: p.why || '', signal: p.signal || '', signalUrl: p.signalUrl || '', industry: p.industry || '', location: p.location || '' };
}

// Also used by private-lookup-start when researching a suggestion.
async function trackProspect(store, prospectId){
  const [prospects, companies] = await Promise.all([readJson(store, KEYS.prospects, []), readJson(store, KEYS.companies, [])]);
  const p = prospects.find(x => x.id === prospectId);
  if(!p) return { error: 'Suggestion not found.' };
  let company = companies.find(c => normalizeName(c.name) === normalizeName(p.name));
  if(!company){
    company = { id: 'co-' + crypto.randomBytes(6).toString('hex'), name: p.name, status: 'not_started', notes: '', followUp: '', createdAt: new Date().toISOString(), lookup: null, lookupStatus: 'none', origin: originOf(p) };
    companies.unshift(company);
    await writeJson(store, KEYS.companies, companies);
  }
  p.state = 'tracked'; p.updatedAt = new Date().toISOString();
  await writeJson(store, KEYS.prospects, prospects);
  return { company };
}

export { trackProspect };

const handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const denied = checkPasscode(event);
  if(denied) return denied;

  let p;
  try{ p = JSON.parse(event.body || '{}'); }catch{ return json(400, { error: 'Invalid JSON body.' }); }

  try{
    const store = openStore(event);
    if(p.action === 'track'){
      const r = await trackProspect(store, p.id);
      return r.error ? json(404, r) : json(200, { ok: true, company: r.company });
    }
    if(p.action === 'dismiss' || p.action === 'restore'){
      const list = await readJson(store, KEYS.prospects, []);
      const item = list.find(x => x.id === p.id);
      if(!item) return json(404, { error: 'Suggestion not found.' });
      item.state = p.action === 'dismiss' ? 'dismissed' : 'open';
      item.updatedAt = new Date().toISOString();
      await writeJson(store, KEYS.prospects, list);
      return json(200, { ok: true, prospect: item });
    }
    return json(400, { error: 'Unknown action.' });
  }catch(err){
    return json(500, { error: err.message });
  }
};

export default v2(handler);
