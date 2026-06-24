const { redactSensitive } = require("./redact");

function isTracingEnabled() {
  return Boolean(
    process.env.LANGSMITH_API_KEY?.trim() ||
      process.env.LANGCHAIN_TRACING_V2 === "true"
  );
}

/**
 * Trace external Composio tool calls. Uses structured logs when LangSmith is not configured.
 * Never logs raw tokens — metadata is redacted before emit.
 */
async function traceComposioToolCall(
  { toolSlug, userId, toolkit, phase = "execute" },
  fn
) {
  const started = Date.now();
  const baseMeta = redactSensitive({
    toolSlug,
    userId,
    toolkit,
    phase,
    provider: "composio",
  });

  try {
    const result = await fn();
    const payload = {
      ...baseMeta,
      ok: true,
      latencyMs: Date.now() - started,
      resultPreview: redactSensitive(
        typeof result === "object" && result !== null
          ? { ok: result.ok, summary: result.summary }
          : { ok: true }
      ),
    };
    console.info("[composio-trace]", JSON.stringify(payload));
    return result;
  } catch (err) {
    const payload = {
      ...baseMeta,
      ok: false,
      latencyMs: Date.now() - started,
      error: err?.message || String(err),
    };
    console.warn("[composio-trace]", JSON.stringify(payload));
    throw err;
  }
}

function logComposioApprovalEvent({ type, userId, approved }) {
  console.info(
    "[composio-trace]",
    JSON.stringify(
      redactSensitive({
        event: "approval",
        type,
        userId,
        approved: Boolean(approved),
        provider: "composio",
      })
    )
  );
}

module.exports = {
  isTracingEnabled,
  traceComposioToolCall,
  logComposioApprovalEvent,
};
