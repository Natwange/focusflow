/**
 * Sentry must be initialized before Express and other instrumented modules load.
 * Require this file as early as possible in the process entrypoint.
 */
require("dotenv").config();

const Sentry = require("@sentry/node");

const dsn = process.env.SENTRY_SERVER_DSN;
if (!dsn) {
  console.log("[sentry] SENTRY_SERVER_DSN is not set; skipping init");
} else {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    // 1.0 is fine for local verification; lower this in production (e.g. 0.1).
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 1.0),
  });
  console.log("[sentry] Sentry initialized");
}

module.exports = { Sentry };
