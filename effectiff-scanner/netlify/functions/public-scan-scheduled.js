// Runs the public web search once a day. Scheduled functions stop after 30
// seconds, so this only starts the background function and exits.
// 15:00 UTC = 8:00 a.m. Pacific daylight time (7:00 a.m. standard time).

const { schedule } = require('@netlify/functions');
const { openStore } = require('./_store');
const { canStart, setStatus } = require('./_public-scan-core');
const { triggerBackground } = require('./_trigger');

const handler = async (event) => {
  if(!process.env.ANTHROPIC_API_KEY) return { statusCode: 200 };
  try{
    const store = openStore(event);
    const gate = await canStart(store);
    if(!gate.ok){ console.log('Scheduled web search skipped:', gate.reason); return { statusCode: 200 }; }
    await setStatus(store, { state: 'queued', startedAt: new Date().toISOString(), error: null });
    await triggerBackground(event, 'public-scan-background', { trigger: 'scheduled' });
  }catch(err){
    console.error('Scheduled web search could not start:', err);
    try{ await setStatus(openStore(event), { state: 'error', error: err.message, finishedAt: new Date().toISOString() }); }catch{}
  }
  return { statusCode: 200 };
};

exports.handler = schedule('0 15 * * *', handler);
