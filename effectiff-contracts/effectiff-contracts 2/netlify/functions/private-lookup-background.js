// Background function (up to 15 minutes): researches one company's
// supplier registration. Started by private-lookup-start. Always returns
// success so Netlify doesn't retry; errors are saved on the company card.

import { v2 } from './_http.js';
import { checkPasscode } from './_contracts-auth.js';
import { runLookup } from './_private-lookup-core.js';

const handler = async (event) => {
  if(checkPasscode(event)) return { statusCode: 200 };
  try{
    const { id } = JSON.parse(event.body || '{}');
    if(id) await runLookup(event, id);
  }catch(err){
    console.error('company lookup failed:', err);
  }
  return { statusCode: 200 };
};

export default v2(handler);
