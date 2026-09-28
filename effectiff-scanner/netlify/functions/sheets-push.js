// POST { list: 'government' | 'public' | 'companies' | 'prospects', ids?: [...] }
// Sends rows to a Google Sheet through the Apps Script web app at
// GOOGLE_SHEET_WEBHOOK_URL (see google-sheet-script.gs for the 5-minute
// setup). Each list goes to its own tab. Rows are matched by the first
// column, so re-sending updates existing rows instead of duplicating them.
// For companies and prospects, omit ids to send all of them (open suggestions only for prospects).

const { openStore, readJson, KEYS } = require('./_store');
const { checkPasscode, json } = require('./_contracts-auth');

const d10 = (v) => (v ? String(v).slice(0, 10) : '');

const LISTS = {
  government: {
    key: KEYS.government,
    sheet: 'Government',
    header: ['ID', 'Found', 'Type', 'Title', 'Agency', 'Response due', 'Posted', 'Set-aside', 'Place', 'Solicitation #', 'NAICS', 'Status', 'Notes', 'Link'],
    row: r => [r.id, d10(r.foundAt), r.type, r.title, r.agency, d10(r.responseDeadline), d10(r.postedDate), r.setAside, r.place, r.solicitationNumber, r.naics, r.status, r.notes, r.link]
  },
  public: {
    key: KEYS.public,
    sheet: 'Public',
    header: ['ID', 'Found', 'Title', 'Organization', 'Type', 'Location', 'Response due', 'Posted', 'Solicitation #', 'Summary', 'Status', 'Notes', 'Link'],
    row: r => [r.id, d10(r.foundAt), r.title, r.organization, r.organizationType, r.location, d10(r.responseDeadline), d10(r.postedDate), r.solicitationNumber, r.summary, r.status, r.notes, r.link]
  },
  prospects: {
    key: KEYS.prospects,
    sheet: 'Company suggestions',
    header: ['Company', 'Tier', 'Industry', 'Location', 'Why', 'Signal', 'Signal source', 'Found', 'State'],
    row: p => [p.name, p.tier, p.industry || '', p.location || '', p.why || '', p.signal || '', p.signalUrl || '', d10(p.foundAt), p.state]
  },
  companies: {
    key: KEYS.companies,
    sheet: 'Private companies',
    header: ['Company', 'Status', 'Follow-up', 'Supplier portal', 'Registration', 'Platform', 'Diversity program', 'Notes', 'Last researched'],
    row: c => {
      const l = c.lookup || {};
      const dp = l.diversityProgram || {};
      return [c.name, c.status, c.followUp || '', l.portalUrl || '', l.registration || '', l.platform || '', [dp.name, dp.url].filter(Boolean).join(' '), c.notes || '', d10(c.lookupAt)];
    }
  }
};

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const denied = checkPasscode(event);
  if(denied) return denied;

  const webhook = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if(!webhook){
    return json(400, { error: 'Google Sheet export isn\'t set up yet — GOOGLE_SHEET_WEBHOOK_URL is not set in Netlify. Use Export CSV instead, or see the README for the one-time setup.' });
  }

  let payload;
  try{ payload = JSON.parse(event.body || '{}'); }
  catch{ return json(400, { error: 'Invalid JSON body.' }); }

  const cfg = LISTS[payload.list || 'government'];
  if(!cfg) return json(400, { error: 'Unknown list.' });

  try{
    const store = openStore(event);
    const all = await readJson(store, cfg.key, []);
    const ids = Array.isArray(payload.ids) ? new Set(payload.ids) : null;
    const pool = payload.list === 'prospects' ? all.filter(p => p.state === 'open') : all;
    const items = ids ? pool.filter(r => ids.has(r.id)) : pool;
    if(!items.length) return json(400, { error: 'Nothing selected to send.' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // text/plain avoids an Apps Script preflight quirk
      body: JSON.stringify({ sheet: cfg.sheet, header: cfg.header, rows: items.map(cfg.row) }),
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);

    const text = await res.text().catch(() => '');
    if(!res.ok) return json(502, { error: `Google Sheet rejected the request (${res.status}). ${text.slice(0, 200)}` });
    let result = {};
    try{ result = JSON.parse(text); }catch{
      return json(502, { error: 'Google Sheet returned an unexpected response. Check that the Apps Script is deployed as a web app with access set to "Anyone".' });
    }
    if(result.ok === false) return json(502, { error: result.error || 'Google Sheet script reported an error.' });
    return json(200, { ok: true, sheet: cfg.sheet, added: result.added || 0, updated: result.updated || 0 });
  }catch(err){
    return json(504, { error: err.name === 'AbortError' ? 'Google Sheet did not respond within 25 seconds.' : err.message });
  }
};
