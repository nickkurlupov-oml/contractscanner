// Visit this endpoint once (as a logged-in QuickBooks admin) to connect
// your QuickBooks company to the scanner. It redirects to Intuit's
// consent screen; QuickBooks then redirects back to qbo-auth-callback.

exports.handler = async () => {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI; // e.g. https://yoursite.netlify.app/.netlify/functions/qbo-auth-callback
  const state = Math.random().toString(36).slice(2);

  const authUrl =
    `https://appcenter.intuit.com/connect/oauth2` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('com.intuit.quickbooks.accounting')}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return {
    statusCode: 302,
    headers: { Location: authUrl }
  };
};
