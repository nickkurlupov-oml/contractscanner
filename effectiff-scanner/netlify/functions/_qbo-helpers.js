// Shared helpers for talking to QuickBooks Online.
// Tokens are stored in Netlify Blobs (a small key/value store built into
// Netlify — no separate database needed) under the "qbo-tokens" store.

const { getStore } = require('@netlify/blobs');

function tokenStore(){
  return getStore('qbo-tokens');
}

// Exchanges an authorization code for access + refresh tokens.
async function exchangeCodeForTokens(code, redirectUri){
  const basicAuth = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });

  if(!res.ok){
    throw new Error(`Token exchange failed: ${await res.text()}`);
  }
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

// Returns a connection object with a valid (non-expired) access token,
// refreshing it first if needed. Throws if QuickBooks was never connected.
async function getValidConnection(){
  const store = tokenStore();
  const conn = await store.get('connection', { type: 'json' });
  if(!conn){
    throw new Error('QuickBooks is not connected yet. Visit /.netlify/functions/qbo-auth-start to connect it.');
  }

  const ageMs = Date.now() - conn.obtained_at;
  const stillValid = ageMs < (conn.expires_in - 60) * 1000; // 60s safety margin
  if(stillValid) return conn;

  const basicAuth = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token
    })
  });

  if(!res.ok){
    throw new Error('QuickBooks token refresh failed — reconnect via /.netlify/functions/qbo-auth-start.');
  }

  const tokens = await res.json();
  const updated = {
    ...conn,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    obtained_at: Date.now(),
    expires_in: tokens.expires_in
  };
  await store.setJSON('connection', updated);
  return updated;
}

async function saveConnection({ realmId, tokens }){
  const store = tokenStore();
  await store.setJSON('connection', {
    realmId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    obtained_at: Date.now(),
    expires_in: tokens.expires_in
  });
}

module.exports = { exchangeCodeForTokens, getValidConnection, saveConnection };
