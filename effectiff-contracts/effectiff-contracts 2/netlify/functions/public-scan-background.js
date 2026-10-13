// Background function (up to 15 minutes): runs the AI web search for
// public solicitations. Started by public-scan-start (button) or
// public-scan-scheduled (daily). Always returns success so Netlify doesn't
// retry — errors are recorded in the scan status the page shows.

import { v2 } from './_http.js';
import { checkPasscode } from './_contracts-auth.js';
import { runPublicScan } from './_public-scan-core.js';

const handler = async (event) => {
  if(checkPasscode(event)) return { statusCode: 200 };
  try{
    let trigger = 'manual';
    try{ trigger = JSON.parse(event.body || '{}').trigger || 'manual'; }catch{}
    await runPublicScan(event, trigger);
  }catch(err){
    console.error('public scan failed:', err);
  }
  return { statusCode: 200 };
};

export default v2(handler);
