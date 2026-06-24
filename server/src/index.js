require("dotenv").config();
const { createApp } = require("./app");
const PORT = process.env.PORT || 4000;
const app = createApp();

function logComposioApiKeyStartupCheck() {
  const raw = process.env.COMPOSIO_API_KEY;
  const exists = raw != null && raw !== "";
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const length = typeof raw === "string" ? raw.length : 0;

  console.log("[startup] COMPOSIO_API_KEY check:", {
    exists,
    length,
    first4: length >= 4 ? raw.slice(0, 4) : null,
    last4: length >= 4 ? raw.slice(-4) : null,
    trimChangesValue: typeof raw === "string" && raw !== trimmed,
  });
}

if (require.main === module) {
  logComposioApiKeyStartupCheck();
  const host = process.env.HOST || "0.0.0.0";
  app.listen(PORT, host, () => {
    console.log(`API listening on http://${host}:${PORT}`);
  });
}

module.exports = { app };
