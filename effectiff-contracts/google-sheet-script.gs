// Google Apps Script for the contracts app's "Send to Google Sheet" button.
//
// SETUP (one time, about 5 minutes):
//   1. Create a Google Sheet (or open the one you want to use).
//   2. Extensions → Apps Script. Delete any placeholder code, paste this
//      whole file in, and save.
//   3. Deploy → New deployment → gear icon → Web app.
//        Execute as: Me
//        Who has access: Anyone
//      Click Deploy, authorize when asked, then copy the Web app URL.
//   4. In Netlify → Site configuration → Environment variables, add
//        GOOGLE_SHEET_WEBHOOK_URL = (that URL)
//      then Deploys → Trigger deploy.
//
// Each list in the app (Government, Public, Private companies) gets its own
// tab, created automatically. Rows are matched on the first column, so
// sending an item again updates its row (e.g. a status change) instead of
// adding a duplicate.
//
// If you edit this script later: Deploy → Manage deployments → edit →
// Version: New version → Deploy. Otherwise the old version keeps running.

function doPost(e){
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    const payload = JSON.parse(e.postData.contents || '{}');
    const header = Array.isArray(payload.header) ? payload.header : [];
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const name = String(payload.sheet || 'Sheet1').slice(0, 90);
    if(!header.length) return reply({ ok: false, error: 'No header received.' });

    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    if(sheet.getLastRow() === 0){
      sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // Map existing first-column values to row numbers.
    const lastRow = sheet.getLastRow();
    const index = {};
    if(lastRow > 1){
      sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach((r, i) => { index[String(r[0])] = i + 2; });
    }

    let added = 0, updated = 0;
    const toAppend = [];
    rows.forEach(r => {
      const row = header.map((_, i) => (r[i] === null || r[i] === undefined) ? '' : r[i]);
      const key = String(row[0]);
      if(key && index[key]){
        sheet.getRange(index[key], 1, 1, header.length).setValues([row]);
        updated++;
      } else {
        toAppend.push(row);
        if(key) index[key] = -1;
        added++;
      }
    });
    if(toAppend.length){
      sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, header.length).setValues(toAppend);
    }
    return reply({ ok: true, added, updated });
  }catch(err){
    return reply({ ok: false, error: String(err) });
  }finally{
    lock.releaseLock();
  }
}

// Open the web app URL in a browser to confirm it's live.
function doGet(){
  return ContentService.createTextOutput('Effectiff contracts sheet endpoint is live.');
}

function reply(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
