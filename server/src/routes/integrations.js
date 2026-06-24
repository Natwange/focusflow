const express = require("express");
const { z } = require("zod");
const { validateBody } = require("../middleware/validateBody");
const { SUPPORTED_TOOLKITS } = require("../integrations/composio/composioToolSlugs");
const {
  listConnectionStatus,
  startConnect,
  completeConnectFromCallback,
  disconnect,
} = require("../integrations/composio/connectionService");
const { isComposioConfigured } = require("../integrations/composio/composioClient");
const { redactSensitive } = require("../integrations/composio/redact");

const router = express.Router();

function errorToPlain(err) {
  if (!err || typeof err !== "object") return err;
  return Object.fromEntries(
    Object.getOwnPropertyNames(err).map((key) => [key, err[key]])
  );
}

function logComposioConnectError(err) {
  console.error("Composio connect error:", {
    name: err?.name,
    message: err?.message,
    cause: redactSensitive(errorToPlain(err?.cause)),
    response: redactSensitive(errorToPlain(err?.response)),
    data: redactSensitive(err?.data),
    error: JSON.stringify(redactSensitive(err?.error ?? null), null, 2),
    raw: JSON.stringify(redactSensitive(errorToPlain(err)), null, 2),
  });
}

const toolkitSchema = z.enum(SUPPORTED_TOOLKITS);

const connectBodySchema = z.object({
  toolkit: toolkitSchema,
});

function clientOrigin() {
  const raw = process.env.CLIENT_ORIGIN || "http://localhost:3000";
  return raw.split(",")[0].trim().replace(/\/$/, "");
}

router.get("/composio/status", async (req, res) => {
  try {
    const connections = await listConnectionStatus(req.user.id);
    return res.json({
      configured: isComposioConfigured(),
      connections,
    });
  } catch (err) {
    console.error("Composio status error:", err);
    return res.status(500).json({ error: "Failed to load integration status." });
  }
});

router.post(
  "/composio/connect",
  validateBody(connectBodySchema),
  async (req, res) => {
    try {
      const result = await startConnect(req.user.id, req.body.toolkit);
      if (!result.ok) {
        return res.status(400).json({ error: result.error || result.summary });
      }
      return res.json({
        redirectUrl: result.redirectUrl,
        toolkit: result.toolkit,
        status: result.status,
      });
    } catch (err) {
      logComposioConnectError(err);
      return res.status(500).json({ error: "Failed to start connection." });
    }
  }
);

router.post(
  "/composio/disconnect",
  validateBody(connectBodySchema),
  async (req, res) => {
    try {
      const result = await disconnect(req.user.id, req.body.toolkit);
      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ toolkit: result.toolkit, status: result.status });
    } catch (err) {
      console.error("Composio disconnect error:", err);
      return res.status(500).json({ error: "Failed to disconnect." });
    }
  }
);

/** OAuth callback — public route mounted separately in app.js */
async function composioOAuthCallback(req, res) {
  try {
    const state = String(req.query.state ?? "");
    const connectedAccountId =
      req.query.connectedAccountId ||
      req.query.connected_account_id ||
      req.query.account_id ||
      null;

    const result = await completeConnectFromCallback({
      state,
      connectedAccountId,
    });

    const redirectBase = clientOrigin();
    if (!result.ok) {
      return res.redirect(
        `${redirectBase}/settings?composio=error&message=${encodeURIComponent(result.error || "connect_failed")}`
      );
    }

    return res.redirect(
      `${redirectBase}/settings?composio=connected&toolkit=${encodeURIComponent(result.toolkit)}`
    );
  } catch (err) {
    console.error("Composio callback error:", err);
    return res.redirect(`${clientOrigin()}/settings?composio=error`);
  }
}

module.exports = router;
module.exports.composioOAuthCallback = composioOAuthCallback;
