/** Parse strings like "15m", "7d", "24h", "3600" (seconds if no unit) into milliseconds. */
function durationToMs(raw, fallback) {
  const s = String(raw ?? fallback).trim();
  const match = /^(\d+)\s*(d|h|m|s)?$/i.exec(s);
  if (!match) return durationToMs(fallback, "15m");
  const n = parseInt(match[1], 10);
  const unit = (match[2] || "s").toLowerCase();
  const mult =
    unit === "d" ? 86400000 : unit === "h" ? 3600000 : unit === "m" ? 60000 : 1000;
  return n * mult;
}

module.exports = { durationToMs };
