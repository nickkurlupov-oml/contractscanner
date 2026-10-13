// Starts a background function (the "-background" functions can run for up
// to 15 minutes; AI web searches need that). Netlify answers a background
// invocation immediately with 202, so this returns quickly.

function siteBase(event){
  const env = (process.env.URL || process.env.SITE_URL || '').replace(/\/$/, '');
  if(env) return env;
  const h = (event && event.headers) || {};
  const host = h['x-forwarded-host'] || h.host;
  return host ? `https://${host}` : '';
}

async function triggerBackground(event, fnName, body){
  const base = siteBase(event);
  if(!base){
    throw new Error('Could not work out the site address to start the background search. Set SITE_URL (e.g. https://effectiff-scanner.netlify.app) in Netlify environment variables.');
  }
  const res = await fetch(`${base}/.netlify/functions/${fnName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-passcode': process.env.CONTRACTS_PASSCODE || '' },
    body: JSON.stringify(body || {})
  });
  if(res.status !== 202 && !res.ok){
    throw new Error(`Couldn't start ${fnName} (HTTP ${res.status}).`);
  }
}

export { triggerBackground };
