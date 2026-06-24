const SENSITIVE_KEY =
  /(?:token|secret|password|authorization|api[_-]?key|refresh|access|credential)/i;

function redactValue(key, value) {
  if (SENSITIVE_KEY.test(String(key))) {
    return "[REDACTED]";
  }
  if (value && typeof value === "object") {
    return redactSensitive(value);
  }
  return value;
}

function redactSensitive(input) {
  if (input == null) return input;
  if (Array.isArray(input)) {
    return input.map((item) =>
      item && typeof item === "object" ? redactSensitive(item) : item
    );
  }
  if (typeof input !== "object") return input;

  const out = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = redactValue(key, value);
  }
  return out;
}

module.exports = {
  redactSensitive,
};
