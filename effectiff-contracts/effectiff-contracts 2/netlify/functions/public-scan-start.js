// POST → starts a public web search in the background (the "Search the web
// now" button). Returns right away; the page polls contracts-list for status.

import { v2 } from './_http.js';
import { checkPasscode, json } from './_contracts-auth.js';
import { openStore } from './_store.js';
import { canStart, setStatus } from './_public-scan-core.js';
import { triggerBackground } from './_trigger.js';

const handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const denied = checkPasscode(event);
  if(denied) return denied;
  if(!process.env.ANTHROPIC_API_KEY){
    return json(400, { error: 'Web search isn\'t set up yet — add ANTHROPIC_API_KEY in Netlify environment variables.' });
  }
  try{
    const store = openStore(event);
    const gate = await canStart(store);
    if(!gate.ok) return json(429, { error: gate.reason });
    await setStatus(store, { state: 'queued', startedAt: new Date().toISOString(), error: null });
    await triggerBackground(event, 'public-scan-background', { trigger: 'manual' });
    return json(202, { started: true });
  }catch(err){
    return json(500, { error: err.message });
  }
};

export default v2(handler);
