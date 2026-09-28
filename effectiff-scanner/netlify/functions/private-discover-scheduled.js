// Checks daily at 15:30 UTC and refreshes company suggestions when due:
// right away if there are none yet, then every 7 days
// (PRIVATE_DISCOVERY_INTERVAL_DAYS). Scheduled functions stop after 30
// seconds, so this only starts the background function.

const { schedule } = require('@netlify/functions');
const { openStore } = require('./_store');
const { canStart, isDue, setStatus } = require('./_private-discover-core');
const { triggerBackground } = require('./_trigger');

const handler = async (event) => {
  if(!process.env.ANTHROPIC_API_KEY) return { statusCode: 200 };
  try{
    const store = openStore(event);
    if(!(await isDue(store))) return { statusCode: 200 };
    const gate = await canStart(store);
    if(!gate.ok){ console.log('Scheduled discovery skipped:', gate.reason); return { statusCode: 200 }; }
    await setStatus(store, { state: 'queued', startedAt: new Date().toISOString(), error: null });
    await triggerBackground(event, 'private-discover-background', { trigger: 'scheduled' });
  }catch(err){
    console.error('Scheduled discovery could not start:', err);
    try{ await setStatus(openStore(event), { state: 'error', error: err.message, finishedAt: new Date().toISOString() }); }catch{}
  }
  return { statusCode: 200 };
};

exports.handler = schedule('30 15 * * *', handler);
