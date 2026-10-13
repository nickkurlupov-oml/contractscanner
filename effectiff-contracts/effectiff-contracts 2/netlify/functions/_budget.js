// Spending guard for the AI-powered features (public web search and
// private-company research).
//
// Every AI run is counted, and its estimated cost (from the token and
// search counts the API reports back) is added to a month-to-date total.
// New runs are refused once any limit is reached:
//   MAX_PUBLIC_SCANS_PER_DAY   default 3
//   MAX_LOOKUPS_PER_DAY        default 20
//   MAX_DISCOVERIES_PER_DAY    default 2
//   MONTHLY_AI_BUDGET_USD      default 25
// All three can be changed with Netlify environment variables.
//
// The estimate uses Anthropic's published per-token and per-search prices
// and should land close to the real bill, but the Claude Console is the
// source of truth — set a spend limit there too as a second safety net.

import { readJson, writeJson, KEYS } from './_store.js';

function limits(){
  return {
    publicScansPerDay: Number(process.env.MAX_PUBLIC_SCANS_PER_DAY || 3),
    lookupsPerDay: Number(process.env.MAX_LOOKUPS_PER_DAY || 20),
    discoveriesPerDay: Number(process.env.MAX_DISCOVERIES_PER_DAY || 2),
    monthlyBudgetUsd: Number(process.env.MONTHLY_AI_BUDGET_USD || 25)
  };
}

function monthKey(d = new Date()){ return d.toISOString().slice(0, 7); }
function dayKey(d = new Date()){ return d.toISOString().slice(0, 10); }

async function readUsage(store){
  const u = await readJson(store, KEYS.usage, null);
  const month = monthKey();
  if(!u || u.month !== month){
    return { month, spentUsd: 0, days: {}, lastCosts: (u && u.lastCosts) || {} };
  }
  u.days = u.days || {};
  u.lastCosts = u.lastCosts || {};
  return u;
}

function todayCounts(usage){
  return Object.assign({ publicScans: 0, lookups: 0, discoveries: 0 }, usage.days[dayKey()] || {});
}

// kind: 'publicScans' | 'lookups' | 'discoveries'
async function checkBudget(store, kind){
  const usage = await readUsage(store);
  const lim = limits();
  const today = todayCounts(usage);
  if(usage.spentUsd >= lim.monthlyBudgetUsd){
    return { ok: false, reason: `This month's AI budget ($${lim.monthlyBudgetUsd.toFixed(2)}) has been reached. Raise MONTHLY_AI_BUDGET_USD in Netlify to allow more, or wait until next month.` };
  }
  if(kind === 'publicScans' && today.publicScans >= lim.publicScansPerDay){
    return { ok: false, reason: `Today's limit of ${lim.publicScansPerDay} web searches has been reached. It resets at midnight UTC.` };
  }
  if(kind === 'discoveries' && today.discoveries >= lim.discoveriesPerDay){
    return { ok: false, reason: `Today's limit of ${lim.discoveriesPerDay} company-suggestion runs has been reached. It resets at midnight UTC.` };
  }
  if(kind === 'lookups' && today.lookups >= lim.lookupsPerDay){
    return { ok: false, reason: `Today's limit of ${lim.lookupsPerDay} company lookups has been reached. It resets at midnight UTC.` };
  }
  return { ok: true };
}

// Count a run when it starts (so failed runs still count toward the daily
// limit — this prevents a broken setup from retrying endlessly).
async function countRun(store, kind){
  const usage = await readUsage(store);
  const d = dayKey();
  usage.days[d] = usage.days[d] || { publicScans: 0, lookups: 0, discoveries: 0 };
  usage.days[d][kind] = (usage.days[d][kind] || 0) + 1;
  // keep only this month's days
  Object.keys(usage.days).forEach(k => { if(!k.startsWith(usage.month)) delete usage.days[k]; });
  await writeJson(store, KEYS.usage, usage);
}

async function addCost(store, kind, costUsd){
  const usage = await readUsage(store);
  usage.spentUsd = Math.round((usage.spentUsd + (costUsd || 0)) * 10000) / 10000;
  usage.lastCosts[kind] = { usd: costUsd, at: new Date().toISOString() };
  await writeJson(store, KEYS.usage, usage);
}

async function usageSummary(store){
  const usage = await readUsage(store);
  return {
    month: usage.month,
    spentUsd: usage.spentUsd,
    today: todayCounts(usage),
    lastCosts: usage.lastCosts,
    limits: limits()
  };
}

export { checkBudget, countRun, addCost, usageSummary };
