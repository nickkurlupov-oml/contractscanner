const { exchangeCodeForTokens, saveConnection } = require('./_qbo-helpers');

exports.handler = async (event) => {
  require('./_store').connectBlobs(event); // Netlify Blobs setup (see _store.js)
  const { code, realmId } = event.queryStringParameters || {};
  if(!code || !realmId){
    return { statusCode: 400, body: 'Missing code or realmId in QuickBooks redirect.' };
  }

  try{
    const tokens = await exchangeCodeForTokens(code, process.env.QBO_REDIRECT_URI);
    await saveConnection({ realmId, tokens });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<html><body style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2>QuickBooks connected</h2>
        <p>You can close this tab and go back to Effectiff Scanner.</p>
      </body></html>`
    };
  }catch(err){
    return { statusCode: 500, body: `Could not connect QuickBooks: ${err.message}` };
  }
};
