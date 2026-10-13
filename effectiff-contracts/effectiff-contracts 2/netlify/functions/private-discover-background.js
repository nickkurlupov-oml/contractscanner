// Background function (up to 15 minutes): finds companies to pursue.
// Always returns success so Netlify doesn't retry; errors are recorded in
// the status the page shows.

import { v2 } from './_http.js';
import { checkPasscode } from './_contracts-auth.js';
import { runDiscovery } from './_private-discover-core.js';

const handler = async (event) => {
  if(checkPasscode(event)) return { statusCode: 200 };
  try{
    let trigger = 'manual';
    try{ trigger = JSON.parse(event.body || '{}').trigger || 'manual'; }catch{}
    await runDiscovery(event, trigger);
  }catch(err){
    console.error('company discovery failed:', err);
  }
  return { statusCode: 200 };
};

export default v2(handler);
