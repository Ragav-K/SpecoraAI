const axios = require('axios');

const senderName = 'Specora AI';
const senderEmail = process.env.EMAIL_FROM || 'noreply@specora.ai';

function buildOtpEmailHtml({ userName, otp, intro, footer }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background:#0a0b0f;font-family:'Segoe UI',Arial,sans-serif;">
      <div style="max-width:480px;margin:40px auto;background:#111318;border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#6c63ff 0%,#8b7fff 100%);padding:32px 24px;text-align:center;">
          <div style="font-size:20px;font-weight:600;color:#fff;letter-spacing:-0.3px;">
            ◈ Specora<span style="opacity:0.85;">AI</span>
          </div>
        </div>
        <div style="padding:32px 28px;">
          <h2 style="color:#f0f2f7;font-size:18px;font-weight:500;margin:0 0 8px;">
            Hey${userName ? ' ' + userName : ''} 👋
          </h2>
          <p style="color:#8a8fa8;font-size:14px;line-height:1.7;margin:0 0 24px;">
            ${intro}
          </p>
          <div style="background:#0a0b0f;border:1px solid rgba(108,99,255,0.3);border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
            <div style="font-size:36px;font-weight:600;letter-spacing:12px;color:#8b7fff;font-family:'Courier New',monospace;">
              ${otp}
            </div>
          </div>
          <p style="color:#555a70;font-size:12.5px;line-height:1.6;margin:0;">
            ${footer}
          </p>
        </div>
        <div style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;">
          <p style="color:#555a70;font-size:11px;margin:0;">
            © ${new Date().getFullYear()} Specora AI — Meeting to Documentation
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function sendBrevoEmail({ to, subject, htmlContent }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ BREVO_API_KEY is not set. Email will not be sent.');
    return;
  }

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: senderName, email: senderEmail },
        to: [{ email: to }],
        subject,
        htmlContent,
      },
      {
        headers: {
          accept: 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
      }
    );

    console.log('✅ Email sent via Brevo API:', response.data.messageId);
    return response.data;
  } catch (error) {
    console.error('❌ Failed to send email:', error.response?.data || error.message);
    throw new Error('Failed to send email via Brevo API');
  }
}

async function sendOTPEmail(to, otp, userName) {
  const htmlContent = buildOtpEmailHtml({
    userName,
    otp,
    intro: 'Use the verification code below to complete your sign-in to Specora AI.',
    footer: "This code expires in <strong style=\"color:#8a8fa8;\">10 minutes</strong>. If you didn't request this code, you can safely ignore this email.",
  });

  return sendBrevoEmail({
    to,
    subject: 'Your Specora AI Verification Code',
    htmlContent,
  });
}

async function sendPasswordResetEmail(to, otp, userName) {
  const htmlContent = buildOtpEmailHtml({
    userName,
    otp,
    intro: 'Use the verification code below to reset your Specora AI password.',
    footer: "This code expires in <strong style=\"color:#8a8fa8;\">10 minutes</strong>. If you didn't request a password reset, please ignore this email or reach out to support.",
  });

  return sendBrevoEmail({
    to,
    subject: 'Your Specora AI Password Reset Code',
    htmlContent,
  });
}

module.exports = { sendOTPEmail, sendPasswordResetEmail };
