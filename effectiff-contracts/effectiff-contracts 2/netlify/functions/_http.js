// Adapts the app's handlers to Netlify's current function format.
// Netlify calls the default export with a standard Request; the handlers
// receive the same simple event object they always have:
//   { httpMethod, headers (lowercase names), body, queryStringParameters }
// and return { statusCode, headers, body }, which becomes a Response.

export function v2(handler){
  return async (req) => {
    const url = new URL(req.url);
    const headers = {};
    req.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
    let body = '';
    if(req.method !== 'GET' && req.method !== 'HEAD'){
      try{ body = await req.text(); }catch{ body = ''; }
    }
    const event = {
      httpMethod: req.method,
      headers,
      body,
      queryStringParameters: Object.fromEntries(url.searchParams)
    };
    const r = (await handler(event)) || {};
    return new Response(r.body === undefined || r.body === null ? '' : String(r.body), {
      status: r.statusCode || 200,
      headers: r.headers || {}
    });
  };
}
