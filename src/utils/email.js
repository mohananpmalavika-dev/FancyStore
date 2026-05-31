const nodemailer = require('nodemailer');

// sendEmail accepts optional transportOptions to override env-based SMTP settings
async function sendEmail(to, subject, text, transportOptions = null, from) {
  const transporter = transportOptions
    ? nodemailer.createTransport(transportOptions)
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

  const info = await transporter.sendMail({
    from: from || process.env.FROM_EMAIL || 'no-reply@example.com',
    to,
    subject,
    text,
  });
  return info;
}

module.exports = sendEmail;
