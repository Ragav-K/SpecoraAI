const axios = require('axios');

const senderName = process.env.EMAIL_FROM_NAME || 'Specora AI';

/**
 * The "from" address. EMAIL_FROM wins everywhere; the fallback only makes
 * sense for Resend, whose sandbox address works without a verified domain
 * (but only delivers to the account owner). Brevo has no equivalent, so a
 * missing EMAIL_FROM there is an error worth surfacing rather than guessing.
 */
function getSenderEmail(provider) {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  if (provider === 'resend') return 'onboarding@resend.dev';
  return null;
}

/**
 * Which email backend to use.
 *   resend  — recommended; requires a domain you can verify by DNS
 *   brevo   — works without a domain, only needs a verified sender address
 *   console — prints the code to the server log; for local development
 */
function getProvider() {
  const name = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (['resend', 'brevo', 'console'].includes(name)) return name;
  console.warn(`Unknown EMAIL_PROVIDER "${name}"; falling back to console.`);
  return 'console';
}

function buildOtpEmailHtml({ userName, otp, intro, footer }) {
  // Light ground + teal accent, matching the app's "Transcript" direction.
  // Email clients are unreliable with stylesheets, so everything is inline.
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background:#F7F8FA;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid rgba(16,20,24,0.09);border-radius:14px;overflow:hidden;">
        <div style="background:#0E7C74;padding:28px 24px;text-align:center;">
          <div style="font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.3px;">
            &#9672; Specora<span style="opacity:0.8;">AI</span>
          </div>
        </div>
        <div style="padding:32px 28px;">
          <h2 style="color:#101418;font-size:18px;font-weight:600;margin:0 0 8px;">
            Hey${userName ? ' ' + userName : ''}
          </h2>
          <p style="color:#59616F;font-size:14px;line-height:1.7;margin:0 0 24px;">
            ${intro}
          </p>
          <div style="background:#F1F3F6;border:1px solid rgba(14,124,116,0.25);border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
            <div style="font-size:34px;font-weight:700;letter-spacing:10px;color:#0E7C74;font-family:'Courier New',Courier,monospace;">
              ${otp}
            </div>
          </div>
          <p style="color:#6B7280;font-size:12.5px;line-height:1.6;margin:0;">
            ${footer}
          </p>
        </div>
        <div style="padding:16px 28px;border-top:1px solid rgba(16,20,24,0.09);text-align:center;">
          <p style="color:#6B7280;font-size:11px;margin:0;">
            &copy; ${new Date().getFullYear()} Specora AI &mdash; Meeting to Documentation
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Resend. Note the domain rule: unless EMAIL_FROM is on a domain verified in
 * your Resend account, Resend will only deliver to the address that owns the
 * account. That surfaces as a 403, so it is explained rather than swallowed.
 */
async function sendViaResend({ to, subject, htmlContent }) {
  const apiKey = process.env.RESEND_API_KEY;
  const senderEmail = getSenderEmail('resend');
  if (!apiKey) {
    throw Object.assign(new Error('RESEND_API_KEY is not set.'), { statusCode: 503 });
  }

  try {
    const { data } = await axios.post(
      'https://api.resend.com/emails',
      {
        from: `${senderName} <${senderEmail}>`,
        to: [to],
        subject,
        html: htmlContent,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Email sent via Resend:', data.id);
    return data;
  } catch (error) {
    const status = error.response?.status;
    const detail = error.response?.data;

    if (status === 403 || status === 422) {
      console.error(
        'Resend refused the send. This usually means the "from" domain is not ' +
          `verified in your Resend account (currently "${senderEmail}"). ` +
          'Until a domain is verified, Resend only delivers to the address that ' +
          'owns the account. Detail:',
        detail
      );
    } else {
      console.error('Resend send failed:', detail || error.message);
    }

    throw new Error('Failed to send email via Resend');
  }
}

/** Brevo. Works without a domain — only the sender address must be verified. */
async function sendViaBrevo({ to, subject, htmlContent }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = getSenderEmail('brevo');
  if (!apiKey) {
    throw Object.assign(new Error('BREVO_API_KEY is not set.'), { statusCode: 503 });
  }
  if (!senderEmail) {
    throw Object.assign(new Error('EMAIL_FROM must be set when using Brevo.'), { statusCode: 503 });
  }

  try {
    const { data } = await axios.post(
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

    console.log('Email sent via Brevo:', data.messageId);
    return data;
  } catch (error) {
    console.error('Brevo send failed:', error.response?.data || error.message);
    throw new Error('Failed to send email via Brevo');
  }
}

/**
 * Development fallback: print the code instead of sending it.
 * Deliberately refuses to run in production — silently "sending" nothing
 * there would lock every new user out of their own account.
 */
async function sendViaConsole({ to, subject, otp }) {
  if (process.env.NODE_ENV === 'production') {
    throw Object.assign(
      new Error('EMAIL_PROVIDER=console is not permitted in production.'),
      { statusCode: 500 }
    );
  }

  console.log(
    '\n──────── EMAIL (console provider — nothing was sent) ────────\n' +
      `  to:      ${to}\n` +
      `  subject: ${subject}\n` +
      `  code:    ${otp}\n` +
      '─────────────────────────────────────────────────────────────\n'
  );
  return { id: 'console' };
}

async function dispatch({ to, subject, htmlContent, otp }) {
  switch (getProvider()) {
    case 'resend':
      return sendViaResend({ to, subject, htmlContent });
    case 'brevo':
      return sendViaBrevo({ to, subject, htmlContent });
    default:
      return sendViaConsole({ to, subject, otp });
  }
}

async function sendOTPEmail(to, otp, userName) {
  return dispatch({
    to,
    otp,
    subject: 'Your Specora AI Verification Code',
    htmlContent: buildOtpEmailHtml({
      userName,
      otp,
      intro: 'Use the verification code below to finish signing in to Specora AI.',
      footer:
        'This code expires in <strong style="color:#59616F;">10 minutes</strong>. ' +
        "If you didn't request it, you can safely ignore this email.",
    }),
  });
}

async function sendPasswordResetEmail(to, otp, userName) {
  return dispatch({
    to,
    otp,
    subject: 'Your Specora AI Password Reset Code',
    htmlContent: buildOtpEmailHtml({
      userName,
      otp,
      intro: 'Use the verification code below to reset your Specora AI password.',
      footer:
        'This code expires in <strong style="color:#59616F;">10 minutes</strong>. ' +
        "If you didn't request a password reset, you can ignore this email.",
    }),
  });
}

/** Describe the active email provider (used by the health endpoint). */
function describeProvider() {
  const provider = getProvider();
  const keyEnv = { resend: 'RESEND_API_KEY', brevo: 'BREVO_API_KEY', console: null }[provider];
  return {
    provider,
    from: provider === 'console' ? null : getSenderEmail(provider),
    configured: keyEnv ? !!process.env[keyEnv] : true,
  };
}

module.exports = { sendOTPEmail, sendPasswordResetEmail, describeProvider };
