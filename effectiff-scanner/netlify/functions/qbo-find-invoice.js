const { getValidConnection } = require('./_qbo-helpers');

exports.handler = async (event) => {
  require('./_store').connectBlobs(event); // Netlify Blobs setup (see _store.js)
  const { company, amount } = event.queryStringParameters || {};
  if(!company){
    return { statusCode: 400, body: 'Missing "company" query parameter.' };
  }

  try{
    const conn = await getValidConnection();

    // QuickBooks' query language doesn't do fuzzy string search well, so
    // pull open invoices and filter client-side against the company name
    // and (optionally) the amount from the check.
    const query = `select * from Invoice where Balance > '0' maxresults 100`;
    const url = `https://quickbooks.api.intuit.com/v3/company/${conn.realmId}/query` +
      `?query=${encodeURIComponent(query)}&minorversion=65`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        Accept: 'application/json'
      }
    });
    if(!res.ok){
      return { statusCode: 502, body: `QuickBooks query failed: ${await res.text()}` };
    }

    const data = await res.json();
    const invoices = (data.QueryResponse && data.QueryResponse.Invoice) || [];

    const companyLower = company.toLowerCase();
    const matches = invoices
      .filter(inv => {
        const name = inv.CustomerRef && inv.CustomerRef.name;
        const nameMatch = name && name.toLowerCase().includes(companyLower);
        if(!nameMatch) return false;
        if(amount){
          return Math.abs(parseFloat(inv.Balance) - parseFloat(amount)) < 0.01;
        }
        return true;
      })
      .map(inv => ({
        docNumber: inv.DocNumber || inv.Id,
        customerId: inv.CustomerRef.value,
        customerName: inv.CustomerRef.name,
        balance: inv.Balance
      }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matches })
    };
  }catch(err){
    return { statusCode: 500, body: err.message };
  }
};
