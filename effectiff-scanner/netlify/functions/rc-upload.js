// Proxies a check-batch upload to Rocket.Chat.
//
// The browser can't always talk to a Rocket.Chat server directly (CORS),
// but this function runs server-side where CORS doesn't apply. The app
// posts JSON here; this reassembles the multipart upload and forwards it.
//
// The person's Rocket.Chat token is passed through per-request and never
// stored anywhere on the server.
//
// Supports both Rocket.Chat upload APIs:
//   - rooms.upload/:rid              (Rocket.Chat 6 and earlier — one step)
//   - rooms.media/:rid + mediaConfirm (Rocket.Chat 7+ — two steps)
// It tries the new API first and falls back to the old one on 404, so it
// keeps working across server upgrades.

const TIMEOUT_MS = 20000;

function withTimeout(promiseFactory){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return promiseFactory(controller.signal).finally(() => clearTimeout(timer));
}

function makeForm(pdfBuffer, filename, msg){
  const form = new FormData();
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename);
  if(msg) form.append('msg', msg);
  return form;
}

// Rocket.Chat 7+: upload the file, then confirm it as a message.
async function uploadViaMedia(origin, headers, roomId, pdfBuffer, filename, msg){
  const mediaRes = await withTimeout(signal => fetch(
    `${origin}/api/v1/rooms.media/${encodeURIComponent(roomId)}`,
    { method: 'POST', headers, body: makeForm(pdfBuffer, filename, ''), signal }
  ));
  const mediaText = await mediaRes.text();
  if(mediaRes.status === 404) return { notSupported: true };
  if(!mediaRes.ok) return { ok: false, status: mediaRes.status, body: mediaText };

  let fileId;
  try{ fileId = JSON.parse(mediaText).file._id; }catch{}
  if(!fileId) return { ok: false, status: mediaRes.status, body: `Upload succeeded but no file id returned: ${mediaText.slice(0, 200)}` };

  const confirmRes = await withTimeout(signal => fetch(
    `${origin}/api/v1/rooms.mediaConfirm/${encodeURIComponent(roomId)}/${encodeURIComponent(fileId)}`,
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ msg: msg || '' }), signal }
  ));
  const confirmText = await confirmRes.text();
  return { ok: confirmRes.ok, status: confirmRes.status, body: confirmText };
}

// Rocket.Chat 6 and earlier: single-step upload.
async function uploadViaLegacy(origin, headers, roomId, pdfBuffer, filename, msg){
  const res = await withTimeout(signal => fetch(
    `${origin}/api/v1/rooms.upload/${encodeURIComponent(roomId)}`,
    { method: 'POST', headers, body: makeForm(pdfBuffer, filename, msg), signal }
  ));
  const text = await res.text();
  if(res.status === 404) return { notSupported: true };
  return { ok: res.ok, status: res.status, body: text };
}

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'POST only' };
  }

  let payload;
  try{
    payload = JSON.parse(event.body || '{}');
  }catch{
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  const { server, userId, authToken, roomId, filename, msg, pdfBase64 } = payload;
  if(!server || !userId || !authToken || !roomId || !filename || !pdfBase64){
    return { statusCode: 400, body: 'Missing one of: server, userId, authToken, roomId, filename, pdfBase64.' };
  }

  // Basic sanity check on the server URL to avoid this becoming an open proxy.
  let base;
  try{
    base = new URL(server);
    if(base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error();
  }catch{
    return { statusCode: 400, body: 'Invalid server URL.' };
  }

  const reply = (statusCode, body) => ({
    statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });

  try{
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const headers = { 'X-Auth-Token': authToken, 'X-User-Id': userId };

    let result = await uploadViaMedia(base.origin, headers, roomId, pdfBuffer, filename, msg);
    let via = 'rooms.media';
    if(result.notSupported){
      result = await uploadViaLegacy(base.origin, headers, roomId, pdfBuffer, filename, msg);
      via = 'rooms.upload';
    }
    if(result.notSupported){
      return reply(502, { ok: false, status: 404, body: 'Neither Rocket.Chat upload API responded (rooms.media and rooms.upload both 404). Check the Server URL and that this user is a member of the room.' });
    }

    return reply(result.ok ? 200 : 502, { ok: result.ok, status: result.status, via, body: String(result.body || '').slice(0, 400) });
  }catch(err){
    const timedOut = err.name === 'AbortError';
    return reply(504, { ok: false, status: 0, body: timedOut ? 'Rocket.Chat did not respond within 20 seconds.' : `Could not reach Rocket.Chat: ${err.message}` });
  }
};
