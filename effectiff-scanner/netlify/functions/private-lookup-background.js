// Background function (up to 15 minutes): researches one company's
// supplier registration. Started by private-lookup-start. Always returns
// success so Netlify doesn't retry; errors are saved on the company card.

const { checkPasscode } = require('./_contracts-auth');
const { runLookup } = require('./_private-lookup-core');

exports.handler = async (event) => {
  if(checkPasscode(event)) return { statusCode: 200 };
  try{
    const { id } = JSON.parse(event.body || '{}');
    if(id) await runLookup(event, id);
  }catch(err){
    console.error('company lookup failed:', err);
  }
  return { statusCode: 200 };
};
