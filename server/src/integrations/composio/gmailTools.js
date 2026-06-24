const { executeComposioAction } = require("./composioClient");
const { getActiveConnectedAccountId } = require("./connectionService");
const { TOOL_SLUGS } = require("./composioToolSlugs");
const { logComposioApprovalEvent } = require("./composioTracing");

const TOOLKIT = "gmail";

function buildEmailPreview(args) {
  return {
    to: args.to,
    subject: args.subject,
    body: args.body,
    cc: args.cc ?? null,
    bcc: args.bcc ?? null,
  };
}

async function runGmailCreateDraft(userId, args) {
  const accountId = await getActiveConnectedAccountId(userId, TOOLKIT);
  if (!accountId) {
    return {
      ok: false,
      summary: "Gmail is not connected. Connect it in Settings first.",
      error: "not_connected",
    };
  }

  const result = await executeComposioAction(
    userId,
    TOOLKIT,
    TOOL_SLUGS.gmail.createDraft,
    {
      recipient_email: args.to,
      subject: args.subject,
      body: args.body,
      cc: args.cc,
      bcc: args.bcc,
    },
    { connectedAccountId: accountId }
  );

  if (!result.ok) {
    return { ok: false, summary: result.summary, error: result.error };
  }

  return {
    ok: true,
    data: { preview: buildEmailPreview(args), draft: result.data },
    summary: `Draft created: "${args.subject}" to ${args.to}.`,
  };
}

async function runGmailSendEmail(userId, args) {
  const accountId = await getActiveConnectedAccountId(userId, TOOLKIT);
  if (!accountId) {
    return {
      ok: false,
      summary: "Gmail is not connected. Connect it in Settings first.",
      error: "not_connected",
    };
  }

  const preview = buildEmailPreview(args);

  if (!args.confirmed) {
    return {
      ok: true,
      data: {
        preview,
        pendingConfirmation: {
          type: "gmail_send_email",
          ...preview,
        },
      },
      summary: `Email preview ready to ${args.to}: "${args.subject}". Say "yes, send it" to confirm — I will not send without approval.`,
    };
  }

  logComposioApprovalEvent({ type: "gmail_send_email", userId, approved: true });

  const result = await executeComposioAction(
    userId,
    TOOLKIT,
    TOOL_SLUGS.gmail.sendEmail,
    {
      recipient_email: args.to,
      subject: args.subject,
      body: args.body,
      cc: args.cc,
      bcc: args.bcc,
    },
    { connectedAccountId: accountId }
  );

  if (!result.ok) {
    return { ok: false, summary: result.summary, error: result.error };
  }

  return {
    ok: true,
    data: { sent: preview, result: result.data },
    summary: `Email sent to ${args.to}: "${args.subject}".`,
  };
}

module.exports = {
  runGmailCreateDraft,
  runGmailSendEmail,
};
