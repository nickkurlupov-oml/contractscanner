// POST → starts a public web search in the background (the "Search the web
// now" button). Returns right away; the page polls contracts-list for status.

const { checkPasscode, json } = require('./_contracts-auth');
const { openStore } = require('./_store');
const { canStart, setStatus } = require('./_public-scan-core');
const { triggerBackground } = require('./_trigger');

exports.handler = async (event) => {
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
