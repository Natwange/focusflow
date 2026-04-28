const jwt = require("jsonwebtoken");
const { ACCESS_TOKEN_COOKIE } = require("../lib/authCookie");

function auth(req, res, next) {
  const token = req.cookies?.[ACCESS_TOKEN_COOKIE];

  if (!token || typeof token !== "string") {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Authentication required" });
  }
}

module.exports = auth;
