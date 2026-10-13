// POST { action: 'add', name }
//      { action: 'update', id, status?, notes?, followUp? }
//      { action: 'delete', id }

import { v2 } from './_http.js';
import { checkPasscode, json } from './_contracts-auth.js';
import { openStore, readJson, writeJson, KEYS } from './_store.js';
import { normalizeName } from './_private-discover-core.js';
import crypto from 'crypto';

const STATUSES = ['not_started', 'researching', 'registered', 'in_contact', 'not_a_fit'];

const handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const denied = checkPasscode(event);
  if(denied) return denied;

  let p;
  try{ p = JSON.parse(event.body || '{}'); }catch{ return json(400, { error: 'Invalid JSON body.' }); }

  try{
    const store = openStore(event);
    const list = await readJson(store, KEYS.companies, []);

    if(p.action === 'add'){
      const name = String(p.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if(!name) return json(400, { error: 'Enter a company name.' });
      const existing = list.find(c => normalizeName(c.name) === normalizeName(name));
      if(existing) return json(200, { ok: true, company: existing });
      const company = { id: 'co-' + crypto.randomBytes(6).toString('hex'), name, status: 'not_started', notes: '', followUp: '', createdAt: new Date().toISOString(), lookup: null, lookupStatus: 'none' };
      list.unshift(company);
      await writeJson(store, KEYS.companies, list);
      // If it was in the suggestions, move it out.
      const prospects = await readJson(store, KEYS.prospects, []);
      const pr = prospects.find(x => x.state === 'open' && normalizeName(x.name) === normalizeName(name));
      if(pr){ pr.state = 'tracked'; pr.updatedAt = new Date().toISOString(); await writeJson(store, KEYS.prospects, prospects); }
      return json(200, { ok: true, company });
    }

    const i = list.findIndex(c => c.id === p.id);
    if(i === -1) return json(404, { error: 'Company not found.' });

    if(p.action === 'delete'){
      list.splice(i, 1);
      await writeJson(store, KEYS.companies, list);
      return json(200, { ok: true });
    }

    if(p.action === 'update'){
      if(p.status !== undefined){
        if(!STATUSES.includes(p.status)) return json(400, { error: `status must be one of: ${STATUSES.join(', ')}` });
        list[i].status = p.status;
      }
      if(p.notes !== undefined) list[i].notes = String(p.notes).slice(0, 4000);
      if(p.followUp !== undefined) list[i].followUp = /^\d{4}-\d{2}-\d{2}$/.test(p.followUp) ? p.followUp : '';
      list[i].updatedAt = new Date().toISOString();
      await writeJson(store, KEYS.companies, list);
      return json(200, { ok: true, company: list[i] });
    }

    return json(400, { error: 'Unknown action.' });
  }catch(err){
    return json(500, { error: err.message });
  }
};

export default v2(handler);
