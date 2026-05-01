function getRequestIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return String(forwardedFor[0]).trim();
  }
  return req.ip || null;
}

function auditAuthEvent(req, { action, userId = null, email = null }) {
  const entry = {
    timestamp: new Date().toISOString(),
    category: "security_auth",
    action,
    userId,
    email,
    ip: getRequestIp(req),
  };

  console.log(JSON.stringify(entry));
}

module.exports = {
  auditAuthEvent,
};
