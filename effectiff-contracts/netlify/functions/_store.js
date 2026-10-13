// Shared Netlify Blobs access for all contracts functions.
//
// These functions use the classic `exports.handler` style ("Lambda
// compatibility mode"). In that mode Netlify Blobs is NOT configured
// automatically — connectLambda(event) must run before getStore(), or every
// read/write fails with "The environment has not been configured to use
// Netlify Blobs". openStore() does that for you.
//
// Uses Netlify Blobs' standard (eventual) consistency. Strong consistency is
// NOT available in this function style: connectLambda() never provides the
// 'uncachedEdgeURL' it needs, and a store configured for strong consistency
// fails on every write as well as every read. A change saved on one device can
// take up to about a minute to appear on another device after a refresh.

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
  return getStore(STORE_NAME);
}

// Returns the fallback only when the key doesn't exist yet. Real errors are
// thrown, never swallowed: silently treating a failed read as "empty" could
// lead a later write to erase saved data.
async function readJson(store, key, fallback){
  const v = await store.get(key, { type: 'json' });
  return v === null || v === undefined ? fallback : v;
}

async function writeJson(store, key, value){
  await store.setJSON(key, value);
}

module.exports = { openStore, connectBlobs, readJson, writeJson, KEYS, STORE_NAME };
