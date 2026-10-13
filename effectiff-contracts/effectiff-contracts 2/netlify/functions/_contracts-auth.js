// Optional lightweight access control for the contracts page.
//
// If CONTRACTS_PASSCODE is set in Netlify environment variables, every
// contracts endpoint requires the same passcode in an `x-passcode` header;
// the contracts page asks for it once and remembers it on the device.
// If the variable is not set, no passcode is required.
//
// This is deliberately simple — it's a shared team passcode, not per-user
// accounts. It keeps casual strangers with the URL from editing statuses
// and notes; it is not a substitute for real authentication if that's
// ever needed.

function checkPasscode(event){
  const required = process.env.CONTRACTS_PASSCODE;
  if(!required) return null; // not configured → open
  const headers = event.headers || {};
  const query = event.queryStringParameters || {};
  // The page sends the passcode as a header. A ?passcode= URL parameter is
  // also accepted so setup checks can be run by visiting a URL in a browser.
  const given = headers['x-passcode'] || headers['X-Passcode'] || query.passcode || '';
  if(given === required) return null;
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'passcode required' })
  };
}

function json(statusCode, body){
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

export { checkPasscode, json };
