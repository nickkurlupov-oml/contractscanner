// Shared Netlify Blobs access for all contracts functions.
//
// These functions use the classic `exports.handler` style ("Lambda
// compatibility mode"). In that mode Netlify Blobs is NOT configured
// automatically — connectLambda(event) must run before getStore(), or every
// read/write fails with "The environment has not been configured to use
// Netlify Blobs". openStore() does that for you.
//
// Reads use strong consistency where the environment supports it, so a
// status change made on one device shows up immediately on another. If
// strong reads aren't available, it quietly falls back to the default
// (eventual) consistency rather than failing.

const { connectLambda, getStore } = require('@netlify/blobs');

const STORE_NAME = 'contracts';

const KEYS = {
  government: 'opportunities',        // SAM.gov findings (key kept from v1)
  governmentSeen: 'seen-notice-ids',
  governmentMeta: 'meta',
  public: 'public-opportunities',     // AI web search findings
  publicStatus: 'public-scan-status',
  companies: 'companies',             // private-company supplier tracker
  prospects: 'prospects',             // AI-suggested companies (priorities + suggestions)
  discoverStatus: 'private-discover-status',
  usage: 'ai-usage'                   // AI spend + daily run counters
};

// Configure Netlify Blobs for this invocation (needed in exports.handler style).
function connectBlobs(event){
  if(event && event.blobs){
    connectLambda(event);
  }
}

function openStore(event){
  connectBlobs(event);
  try{
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  }catch{
    return getStore(STORE_NAME);
  }
}

async function readJson(store, key, fallback){
  try{
    const v = await store.get(key, { type: 'json' });
    return v === null || v === undefined ? fallback : v;
  }catch(err){
    // Strong consistency not available here → retry with default consistency.
    try{
      const v = await store.get(key, { type: 'json', consistency: 'eventual' });
      return v === null || v === undefined ? fallback : v;
    }catch{
      return fallback;
    }
  }
}

async function writeJson(store, key, value){
  await store.setJSON(key, value);
}

module.exports = { openStore, connectBlobs, readJson, writeJson, KEYS, STORE_NAME };
