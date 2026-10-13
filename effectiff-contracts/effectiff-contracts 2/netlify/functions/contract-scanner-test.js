// Manual SAM.gov scan — used by the page's "Scan SAM.gov now" button and
// for setup checks. Add ?dryRun=true to see what would be saved without
// saving it. Each call uses one of SAM.gov's ~10 daily requests.
//
//   /.netlify/functions/contract-scanner-test
//   /.netlify/functions/contract-scanner-test?dryRun=true

import { v2 } from './_http.js';
import { runScan } from './_contract-scanner-core.js';
import { checkPasscode } from './_contracts-auth.js';

const handler = async (event) => {
  const denied = checkPasscode(event);
  if(denied) return denied;
  const dryRun = (event.queryStringParameters || {}).dryRun === 'true';
  try{
    const result = await runScan({ dryRun, event });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result, null, 2) };
  }catch(err){
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};

export default v2(handler);
