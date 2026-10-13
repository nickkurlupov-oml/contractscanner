// GET → everything the contracts page shows, for all three tabs.

import { v2 } from './_http.js';
import { openStore, readJson, KEYS, storageMode } from './_store.js';
import { usageSummary } from './_budget.js';
import { checkPasscode, json } from './_contracts-auth.js';

const STALE_MS = 16 * 60 * 1000;

const handler = async (event) => {
  const denied = checkPasscode(event);
  if(denied) return denied;

  try{
    const store = openStore(event);
    const [government, publicList, companies, govMeta, publicStatus, usage, prospects, discoverStatus] = await Promise.all([
      readJson(store, KEYS.government, []),
      readJson(store, KEYS.public, []),
      readJson(store, KEYS.companies, []),
      readJson(store, KEYS.governmentMeta, {}),
      readJson(store, KEYS.publicStatus, {}),
      usageSummary(store),
      readJson(store, KEYS.prospects, []),
      readJson(store, KEYS.discoverStatus, {})
    ]);

    // A background run that never reported back (e.g. it crashed or never
    // started) shouldn't show "running" forever.
    const now = Date.now();
    if((publicStatus.state === 'queued' || publicStatus.state === 'running') && publicStatus.startedAt && now - new Date(publicStatus.startedAt).getTime() > STALE_MS){
      publicStatus.state = 'error';
      publicStatus.error = 'The web search stopped without finishing. Check Netlify → Logs → Functions → public-scan-background.';
    }
    if((discoverStatus.state === 'queued' || discoverStatus.state === 'running') && discoverStatus.startedAt && now - new Date(discoverStatus.startedAt).getTime() > STALE_MS){
      discoverStatus.state = 'error';
      discoverStatus.error = 'The company search stopped without finishing. Check Netlify → Logs → Functions → private-discover-background.';
    }
    companies.forEach(c => {
      if((c.lookupStatus === 'queued' || c.lookupStatus === 'running') && c.lookupStartedAt && now - new Date(c.lookupStartedAt).getTime() > STALE_MS){
        c.lookupStatus = 'error';
        c.lookupError = 'The research stopped without finishing. Try again.';
      }
    });

    return json(200, {
      government,
      public: publicList,
      companies,
      prospects: prospects.filter(p => p.state !== 'tracked'),
      discoverStatus,
      governmentMeta: govMeta,
      publicStatus,
      usage,
      setup: {
        samKey: !!process.env.SAM_API_KEY,
        aiKey: !!process.env.ANTHROPIC_API_KEY,
        sheet: !!process.env.GOOGLE_SHEET_WEBHOOK_URL,
        storage: storageMode()   // 'strong' = saves show instantly
      }
    });
  }catch(err){
    return json(500, { error: err.message });
  }
};

export default v2(handler);
