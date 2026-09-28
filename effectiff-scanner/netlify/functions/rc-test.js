// Verifies Rocket.Chat connection details without sending anything:
// 1. /api/info        — is this actually a Rocket.Chat server?
// 2. /api/v1/me       — do the token + user id work?
// 3. rooms.info       — does each provided room id exist and is it accessible?

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

  const { server, userId, authToken, rooms } = payload; // rooms: { name: roomId }
  const results = { server: null, auth: null, rooms: {} };

  let base;
  try{
    base = new URL(server);
  }catch{
    return json({ ...results, server: 'Invalid URL format.' });
  }

  const authHeaders = { 'X-Auth-Token': authToken || '', 'X-User-Id': userId || '' };

  // 1. Is it a Rocket.Chat server?
  try{
    const res = await fetchTimeout(`${base.origin}/api/info`, {}, 8000);
    const body = await res.json().catch(() => null);
    if(body && (body.info || body.version)){
      results.server = 'ok';
    } else {
      results.server = 'Reachable, but does not look like a Rocket.Chat server (no /api/info). Check the URL.';
      return json(results);
    }
  }catch(err){
    results.server = `Unreachable: ${err.name === 'AbortError' ? 'timed out' : err.message}`;
    return json(results);
  }

  // 2. Do the credentials work?
  try{
    const res = await fetchTimeout(`${base.origin}/api/v1/me`, { headers: authHeaders }, 8000);
    if(res.ok){
      const me = await res.json();
      results.auth = `ok (logged in as ${me.username || userId})`;
    } else {
      results.auth = `Rejected (${res.status}) — check the User Id and Auth Token.`;
      return json(results);
    }
  }catch(err){
    results.auth = `Failed: ${err.message}`;
    return json(results);
  }

  // 3. Does each room exist and is it accessible?
  for(const [name, roomId] of Object.entries(rooms || {})){
    if(!roomId){ results.rooms[name] = 'no room id saved'; continue; }
    try{
      const res = await fetchTimeout(
        `${base.origin}/api/v1/rooms.info?roomId=${encodeURIComponent(roomId)}`,
        { headers: authHeaders }, 8000
      );
      if(res.ok){
        results.rooms[name] = 'ok';
      } else {
        results.rooms[name] = `not found or no access (${res.status}) — check the room id and that this user is a member`;
      }
    }catch(err){
      results.rooms[name] = `check failed: ${err.message}`;
    }
  }

  return json(results);
};

function json(body){
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function fetchTimeout(url, options, ms){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try{
    return await fetch(url, { ...options, signal: controller.signal });
  }finally{
    clearTimeout(timer);
  }
}
