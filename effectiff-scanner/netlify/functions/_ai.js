// Calls the Claude API with its built-in web search tool.
//
// Requires ANTHROPIC_API_KEY in Netlify environment variables.
// Model defaults to Claude Sonnet 5.5; override with ANTHROPIC_MODEL
// (e.g. claude-haiku-4-5 to roughly halve the cost).
//
// Returns the model's final text, an estimated cost, and the set of URLs
// that actually appeared in search results — callers use that set to drop
// any link the model didn't really find.

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CONTINUATIONS = 4; // for long searches the API pauses with stop_reason "pause_turn"

// USD per million tokens (input, output, cache write 5m, cache read),
// from Anthropic's published pricing. Used only to estimate spend.
const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10, cw: 2.5, cr: 0.2 },
  'claude-sonnet-5':   { in: 2, out: 10, cw: 2.5, cr: 0.2 },
  'claude-haiku-4-5':  { in: 1, out: 5, cw: 1.25, cr: 0.1 },
  'claude-opus-5-5':   { in: 4, out: 20, cw: 5, cr: 0.2 }
};
const SEARCH_PRICE_USD = 0.01; // $10 per 1,000 searches

function priceFor(model){
  const key = Object.keys(PRICES).find(k => model === k || model.startsWith(k + '-'));
  return PRICES[key] || PRICES[DEFAULT_MODEL];
}

function estimateCost(model, usage){
  const p = priceFor(model);
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const searches = (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  const usd = (inTok * p.in + outTok * p.out + cw * p.cw + cr * p.cr) / 1e6 + searches * SEARCH_PRICE_USD;
  return { usd: Math.round(usd * 10000) / 10000, searches, inputTokens: inTok + cw + cr, outputTokens: outTok };
}

function addUsage(total, u){
  if(!u) return total;
  total.input_tokens = (total.input_tokens || 0) + (u.input_tokens || 0);
  total.output_tokens = (total.output_tokens || 0) + (u.output_tokens || 0);
  total.cache_creation_input_tokens = (total.cache_creation_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  total.cache_read_input_tokens = (total.cache_read_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const s = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  total.server_tool_use = { web_search_requests: ((total.server_tool_use && total.server_tool_use.web_search_requests) || 0) + s };
  return total;
}

function normalizeUrl(u){
  try{
    const url = new URL(String(u).trim());
    url.hash = '';
    [...url.searchParams.keys()].forEach(k => { if(/^utm_|^fbclid$|^gclid$/i.test(k)) url.searchParams.delete(k); });
    let s = `${url.protocol}//${url.host.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`;
    const q = url.searchParams.toString();
    if(q) s += '?' + q;
    return s.replace(/^http:/, 'https:');
  }catch{
    return '';
  }
}

function hostOf(u){
  try{ return new URL(u).host.toLowerCase().replace(/^www\./, ''); }catch{ return ''; }
}

function collectResultUrls(content, urlSet, hostSet){
  (content || []).forEach(block => {
    if(block.type === 'web_search_tool_result' && Array.isArray(block.content)){
      block.content.forEach(r => {
        if(r && r.url){ urlSet.add(normalizeUrl(r.url)); hostSet.add(hostOf(r.url)); }
      });
    }
    if(block.type === 'text' && Array.isArray(block.citations)){
      block.citations.forEach(c => {
        if(c && c.url){ urlSet.add(normalizeUrl(c.url)); hostSet.add(hostOf(c.url)); }
      });
    }
  });
}

// Checks a URL against what search actually returned.
// 'exact' = same page seen in results; 'site' = same website seen; null = never seen.
function linkCheck(url, found){
  if(!url) return null;
  const n = normalizeUrl(url);
  if(!n) return null;
  if(found.urls.has(n)) return 'exact';
  if(found.hosts.has(hostOf(url))) return 'site';
  return null;
}

function extractJson(text){
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for(let i = fences.length - 1; i >= 0; i--){
    try{ return JSON.parse(fences[i][1].trim()); }catch{}
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if(start !== -1 && end > start){
    try{ return JSON.parse(text.slice(start, end + 1)); }catch{}
  }
  return null;
}

async function callApi(body){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try{
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try{ data = JSON.parse(text); }catch{}
    if(!res.ok){
      const msg = (data && data.error && data.error.message) || text.slice(0, 300);
      if(res.status === 401) throw new Error('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Netlify.');
      if(res.status === 400 && /web search/i.test(msg)) throw new Error(`Web search isn't enabled for this Anthropic organization. An admin can turn it on in the Claude Console (Settings → Capabilities). Details: ${msg}`);
      if(res.status === 402 || /credit balance/i.test(msg)) throw new Error('The Anthropic account is out of credit. Add credit or a payment method in the Claude Console.');
      if(res.status === 429) throw new Error('The Anthropic API rate limit was hit. Try again in a few minutes.');
      if(res.status === 529 || res.status >= 500) throw new Error(`The Anthropic API is temporarily unavailable (${res.status}). Try again later.`);
      throw new Error(`Anthropic API error ${res.status}: ${msg}`);
    }
    return data;
  }catch(err){
    if(err.name === 'AbortError') throw new Error('The AI search took longer than 5 minutes and was stopped.');
    throw err;
  }finally{
    clearTimeout(timer);
  }
}

async function searchWithClaude({ system, prompt, maxSearches = 6, maxTokens = 4000 }){
  if(!process.env.ANTHROPIC_API_KEY){
    throw new Error('ANTHROPIC_API_KEY is not set in Netlify environment variables.');
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }];
  const messages = [{ role: 'user', content: prompt }];
  const found = { urls: new Set(), hosts: new Set() };
  let usage = {};
  let finalText = '';

  for(let turn = 0; turn <= MAX_CONTINUATIONS; turn++){
    const data = await callApi({ model, max_tokens: maxTokens, system, messages, tools });
    usage = addUsage(usage, data.usage);
    collectResultUrls(data.content, found.urls, found.hosts);

    if(data.stop_reason === 'pause_turn'){
      // Long search turn was paused — send the partial turn back unchanged to continue.
      messages.push({ role: 'assistant', content: data.content });
      continue;
    }
    finalText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    break;
  }

  const cost = estimateCost(model, usage);
  return { model, text: finalText, json: extractJson(finalText), cost, found };
}

module.exports = { searchWithClaude, linkCheck, normalizeUrl, extractJson };
