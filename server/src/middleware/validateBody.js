function formatZodIssues(issues) {
  if (!issues.length) return "Invalid input";
  const i = issues[0];
  const path = i.path.length ? `${i.path.join(".")}: ` : "";
  let msg = `${path}${i.message}`;
  if (issues.length > 1) msg += ` (+${issues.length - 1} more)`;
  return msg;
}

/**
 * Express middleware: parse and validate req.body with a Zod schema.
 * On success, replaces req.body with the parsed output (defaults applied, extra keys stripped).
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return res.status(400).json({ error: formatZodIssues(result.error.issues) });
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validateBody, formatZodIssues };
