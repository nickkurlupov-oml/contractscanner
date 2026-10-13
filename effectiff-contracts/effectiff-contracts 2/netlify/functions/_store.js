// Shared Netlify Blobs access for all contracts functions.
//
// These functions use Netlify's current function format, where Netlify Blobs
// is configured automatically, including what strong consistency needs.
//
// Reads use STRONG consistency, so a save is visible immediately to the next
// read on any device, and quick successive edits can't overwrite each other
// from stale data. If strong reads are ever unavailable, reads fall back to
// standard (eventual) consistency instead of failing; storageMode() reports
// which one is in use. Writes don't depend on the consistency setting.

import { getStore } from '@netlify/blobs';

export const STORE_NAME = 'contracts';

export const KEYS = {
  government: 'opportunities',        // SAM.gov findings
  governmentSeen: 'seen-notice-ids',
  governmentMeta: 'meta',
  public: 'public-opportunities',     // AI web search findings
  publicStatus: 'public-scan-status',
  companies: 'companies',             // private-company supplier tracker
  prospects: 'prospects',             // AI-suggested companies (priorities + suggestions)
  discoverStatus: 'private-discover-status',
  usage: 'ai-usage'                   // AI spend + daily run counters
};

let mode = 'unknown';
export function storageMode(){ return mode; }

// `event` is accepted for compatibility with older call sites; not needed now.
export function openStore(event){
  return getStore(STORE_NAME);
}

// Returns the fallback only when the key doesn't exist yet. Real errors are
// thrown, never swallowed: treating a failed read as "empty" could lead a
// later write to erase saved data.
export async function readJson(store, key, fallback){
  let v;
  try{
    v = await store.get(key, { type: 'json', consistency: 'strong' });
    mode = 'strong';
  }catch(err){
    if(!err || err.name !== 'BlobsConsistencyError') throw err;
    v = await store.get(key, { type: 'json' });
    mode = 'eventual';
  }
  return v === null || v === undefined ? fallback : v;
}

export async function writeJson(store, key, value){
  await store.setJSON(key, value);
}
