const { redactSensitive } = require("./redact");
const { traceComposioToolCall } = require("./composioTracing");
const { isSupportedToolkit } = require("./composioToolSlugs");

/** @type {import('@composio/core').Composio | null} */
let clientSingleton = null;
/** @type {Promise<typeof import('@composio/core')> | null} */
let modulePromise = null;
/** @type {import('@composio/core').Composio | null} */
let clientOverride = null;

function isComposioConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim()) || clientOverride != null;
}

async function loadComposioModule() {
  if (!modulePromise) {
    modulePromise = import("@composio/core");
  }
  return modulePromise;
}

async function getComposioClient() {
  if (clientOverride) return clientOverride;
  if (!isComposioConfigured()) return null;
  if (!clientSingleton) {
    const { Composio } = await loadComposioModule();
    clientSingleton = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY?.trim(),
      allowTracking: false,
    });
  }
  return clientSingleton;
}

function getAuthConfigId(toolkit) {
  const key = String(toolkit ?? "").toLowerCase();
  const envMap = {
    googlecalendar: process.env.COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR,
    gmail: process.env.COMPOSIO_AUTH_CONFIG_GMAIL,
    notion: process.env.COMPOSIO_AUTH_CONFIG_NOTION,
  };
  const raw = envMap[key]?.trim();
  return raw || null;
}

function getPublicApiBase() {
  const raw =
    process.env.PUBLIC_API_URL?.trim() ||
    process.env.API_PUBLIC_URL?.trim() ||
    "";
  return raw.replace(/\/$/, "");
}

function composioUserId(focusflowUserId) {
  return `focusflow_${focusflowUserId}`;
}

/**
 * @param {string} focusflowUserId
 * @param {string} toolkit
 * @param {string} toolSlug
 * @param {object} args
 * @param {{ connectedAccountId?: string }} [opts]
 */
async function executeComposioAction(
  focusflowUserId,
  toolkit,
  toolSlug,
  args,
  opts = {}
) {
  if (!isSupportedToolkit(toolkit)) {
    return {
      ok: false,
      error: `Unsupported toolkit: ${toolkit}`,
      summary: `Toolkit "${toolkit}" is not supported.`,
    };
  }

  return traceComposioToolCall(
    { toolSlug, userId: focusflowUserId, toolkit },
    async () => {
      const client = await getComposioClient();
      if (!client) {
        return {
          ok: false,
          error: "Composio is not configured.",
          summary:
            "External integrations are unavailable — COMPOSIO_API_KEY is not set on the server.",
        };
      }

      const connectedAccountId = opts.connectedAccountId;
      if (!connectedAccountId) {
        return {
          ok: false,
          error: "No connected account.",
          summary: `Connect ${toolkit} in Settings before using this action.`,
        };
      }

      try {
        const response = await client.tools.execute(toolSlug, {
          userId: composioUserId(focusflowUserId),
          connectedAccountId,
          arguments: args,
        });

        return {
          ok: true,
          data: redactSensitive(response?.data ?? response),
          summary: "External action completed.",
          raw: redactSensitive(response),
        };
      } catch (err) {
        const message = err?.message || "Composio action failed.";
        return {
          ok: false,
          error: message,
          summary: message,
        };
      }
    }
  );
}

/** Test-only hooks */
function setComposioClientForTests(client) {
  clientOverride = client;
  clientSingleton = null;
}

function resetComposioClientForTests() {
  clientOverride = null;
  clientSingleton = null;
  modulePromise = null;
}

module.exports = {
  isComposioConfigured,
  getComposioClient,
  getAuthConfigId,
  getPublicApiBase,
  composioUserId,
  executeComposioAction,
  setComposioClientForTests,
  resetComposioClientForTests,
};
