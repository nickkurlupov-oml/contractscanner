// Emails a copy of every sent check batch (as PDF) to the records inbox.
// Called by the scanner app right after a successful Rocket.Chat upload.
//
// Requires these environment variables in Netlify:
//   SMTP_HOST     e.g. smtp.office365.com or your mail provider's host
//   SMTP_PORT     e.g. 587
//   SMTP_USER     the mailbox that sends (e.g. scanner@effectiff.com)
//   SMTP_PASS     its password or app password
//   RECORDS_EMAIL defaults to assistant@effectiff.com if unset

const nodemailer = require('nodemailer');

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

  const { filename, pdfBase64, subject, bodyText } = payload;
  if(!filename || !pdfBase64){
    return { statusCode: 400, body: 'Missing filename or pdfBase64.' };
  }

  // ~8 MB cap after base64 decode — matches typical function payload limits.
  if(pdfBase64.length > 11 * 1024 * 1024){
    return { statusCode: 413, body: 'PDF too large to email through this function.' };
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  if(!host || !user){
    return { statusCode: 500, body: 'Email is not configured yet — set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in Netlify environment variables.' };
  }

  try{
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: user,
      to: process.env.RECORDS_EMAIL || 'assistant@effectiff.com',
      subject: subject || `Check batch: ${filename}`,
      text: bodyText || 'Automated copy of a check batch sent via Effectiff Scanner.',
      attachments: [{
        filename,
        content: pdfBase64,
        encoding: 'base64',
        contentType: 'application/pdf'
      }]
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }catch(err){
    return { statusCode: 502, body: `Email send failed: ${err.message}` };
  }
};
