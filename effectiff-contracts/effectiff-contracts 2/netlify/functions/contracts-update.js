// POST { list: 'government' | 'public', id, status?, notes? }
// status: new | interested | applied | dismissed

import { v2 } from './_http.js';
import { openStore, readJson, writeJson, KEYS } from './_store.js';
import { checkPasscode, json } from './_contracts-auth.js';

const STATUSES = ['new', 'interested', 'applied', 'dismissed'];

const handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const denied = checkPasscode(event);
  if(denied) return denied;

  let payload;
  try{ payload = JSON.parse(event.body || '{}'); }
  catch{ return json(400, { error: 'Invalid JSON body.' }); }

  const { id, status, notes } = payload;
  const listName = payload.list || 'government';
  const key = listName === 'public' ? KEYS.public : listName === 'government' ? KEYS.government : null;
  if(!key) return json(400, { error: 'list must be "government" or "public".' });
  if(!id) return json(400, { error: 'Missing id.' });
  if(status !== undefined && !STATUSES.includes(status)){
    return json(400, { error: `status must be one of: ${STATUSES.join(', ')}` });
  }

  try{
    const store = openStore(event);
    const list = await readJson(store, key, []);
    const idx = list.findIndex(r => r.id === id);
    if(idx === -1) return json(404, { error: 'Not found.' });

    if(status !== undefined) list[idx].status = status;
    if(notes !== undefined) list[idx].notes = String(notes).slice(0, 2000);
    list[idx].updatedAt = new Date().toISOString();

    await writeJson(store, key, list);
    return json(200, { ok: true, opportunity: list[idx] });
  }catch(err){
    return json(500, { error: err.message });
  }
};

export default v2(handler);
