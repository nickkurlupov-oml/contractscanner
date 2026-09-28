const { getValidConnection } = require('./_qbo-helpers');

// QuickBooks doesn't have a direct "mark invoice paid" flag to flip —
// paid status is derived from recording a Payment against the invoice.
// This creates that Payment, linked to the invoice by TxnId.
exports.handler = async (event) => {
  require('./_store').connectBlobs(event); // Netlify Blobs setup (see _store.js)
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'POST only' };
  }

  let payload;
  try{
    payload = JSON.parse(event.body || '{}');
  }catch{
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  const { invoiceId, customerId, amount } = payload;
  if(!invoiceId || !customerId || !amount){
    return { statusCode: 400, body: 'Missing invoiceId, customerId, or amount.' };
  }

  try{
    const conn = await getValidConnection();

    const payment = {
      TotalAmt: Number(amount),
      CustomerRef: { value: customerId },
      Line: [{
        Amount: Number(amount),
        LinkedTxn: [{ TxnId: invoiceId, TxnType: 'Invoice' }]
      }]
    };

    const url = `https://quickbooks.api.intuit.com/v3/company/${conn.realmId}/payment?minorversion=65`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payment)
    });

    const data = await res.json();
    if(!res.ok){
      return { statusCode: 502, body: JSON.stringify(data) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  }catch(err){
    return { statusCode: 500, body: err.message };
  }
};
