// Runs the SAM.gov (federal) scan automatically every 6 hours.
// See _contract-scanner-core.js for the logic.

const { schedule } = require('@netlify/functions');
const { runScan } = require('./_contract-scanner-core');

const handler = async function(event){
  try{
    const result = await runScan({ dryRun: false, event });
    console.log(`SAM.gov scan: fetched ${result.totalFetched}, added ${(result.added || []).length} new.`);
  }catch(err){
    console.error('SAM.gov scan failed:', err);
  }
  return { statusCode: 200 };
};

// Every 6 hours (4 runs/day). SAM.gov personal API keys allow roughly 10
// requests/day, and each manual scan also costs one — don't tighten this
// without upgrading to a SAM.gov system account (see README).
exports.handler = schedule('0 */6 * * *', handler);
