const sanitizeHtml = require("sanitize-html");

const PLAIN_TEXT_SANITIZE_OPTIONS = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "discard",
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
};

function sanitizeUserText(value) {
  if (value === undefined || value === null) return value;
  return sanitizeHtml(String(value), PLAIN_TEXT_SANITIZE_OPTIONS);
}

function sanitizeObjectTextFields(input, keys) {
  const out = { ...input };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(out, key) && out[key] !== undefined) {
      out[key] = sanitizeUserText(out[key]);
    }
  }
  return out;
}

module.exports = {
  sanitizeUserText,
  sanitizeObjectTextFields,
};
