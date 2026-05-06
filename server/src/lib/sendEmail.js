/**
 * Sends email via [Resend](https://resend.com). If RESEND_API_KEY is unset in development,
 * the message is logged to the server console instead (so local work continues).
 */

function appPublicOrigin() {
  const raw = (process.env.PUBLIC_APP_URL || process.env.CLIENT_ORIGIN || "")
    .split(",")[0]
    .trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

function defaultFromAddress() {
  return (
    process.env.EMAIL_FROM ||
    "FocusFlow <onboarding@resend.dev>"
  );
}

async function sendTransactionalEmail({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = defaultFromAddress();

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[email] RESEND_API_KEY is missing in production — email not sent."
      );
      throw new Error("Email is not configured (RESEND_API_KEY).");
    }
    console.warn("[email] RESEND_API_KEY not set — logging email instead of sending.");
    console.warn(`[email] To: ${to}\nSubject: ${subject}\n\n${text}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[email] Resend error:", res.status, body);
    throw new Error("Failed to send email");
  }
}

function passwordResetEmailContent({ resetUrl }) {
  const subject = "Reset your FocusFlow password";
  const text = `We received a request to reset your FocusFlow password.

Open this link (valid for a limited time):
${resetUrl}

If you did not request this, you can ignore this message.`;
  const html = `<p>We received a request to reset your FocusFlow password.</p>
<p><a href="${resetUrl}">Reset your password</a></p>
<p>If you did not request this, you can ignore this message.</p>`;
  return { subject, text, html };
}

function emailVerificationContent({ verifyUrl }) {
  const subject = "Verify your FocusFlow email";
  const text = `Welcome to FocusFlow.

Please confirm this email address by opening:
${verifyUrl}

If you did not create an account, you can ignore this message.`;
  const html = `<p>Welcome to FocusFlow.</p>
<p><a href="${verifyUrl}">Verify your email</a></p>
<p>If you did not create an account, you can ignore this message.</p>`;
  return { subject, text, html };
}

async function sendPasswordResetEmail(userEmail, plainToken) {
  const base = appPublicOrigin();
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(plainToken)}`;
  const { subject, text, html } = passwordResetEmailContent({ resetUrl });
  await sendTransactionalEmail({ to: userEmail, subject, text, html });
}

async function sendEmailVerificationEmail(userEmail, plainToken) {
  const base = appPublicOrigin();
  const verifyUrl = `${base}/verify-email?token=${encodeURIComponent(plainToken)}`;
  const { subject, text, html } = emailVerificationContent({ verifyUrl });
  await sendTransactionalEmail({ to: userEmail, subject, text, html });
}

module.exports = {
  appPublicOrigin,
  sendTransactionalEmail,
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
};
