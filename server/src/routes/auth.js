const express = require("express");
const bcrypt = require("bcrypt");
const prisma = require("../lib/prisma");
const { prismaErrorMessage } = require("../lib/prismaErrors");
const { clearSessionCookies } = require("../lib/authCookie");
const { auditAuthEvent } = require("../lib/auditLogger");
const {
  establishSession,
  revokeRefreshByCookie,
  rotateRefreshSession,
} = require("../lib/authSession");
const { validateBody } = require("../middleware/validateBody");
const { registerBodySchema, loginBodySchema } = require("../validation/schemas");

const router = express.Router();

function requireJwtSecret(res) {
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not set in server .env");
    res.status(500).json({
      error:
        "Server misconfiguration: JWT_SECRET is not set. Add JWT_SECRET to server/.env",
    });
    return false;
  }
  return true;
}

// POST /auth/register
router.post("/register", validateBody(registerBodySchema), async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!requireJwtSecret(res)) return;

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({ error: "Email is already in use" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    await establishSession(res, user);

    return res.status(201).json(user);
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// POST /auth/login
router.post("/login", validateBody(loginBodySchema), async (req, res) => {
  try {
    if (!requireJwtSecret(res)) return;

    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, password: true },
    });
    if (!user) {
      auditAuthEvent(req, {
        action: "login_failure",
        email,
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      auditAuthEvent(req, {
        action: "login_failure",
        email: user.email,
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    await establishSession(res, {
      id: user.id,
      email: user.email,
      name: user.name || "",
    });
    auditAuthEvent(req, {
      action: "login_success",
      email: user.email,
    });

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name || "",
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

// POST /auth/refresh — rotate refresh token; no access JWT required
router.post("/refresh", async (req, res) => {
  try {
    if (!requireJwtSecret(res)) return;

    const ok = await rotateRefreshSession(req, res);
    if (!ok) {
      auditAuthEvent(req, { action: "refresh_token_failure" });
      return res.status(401).json({ error: "Session expired" });
    }
    auditAuthEvent(req, { action: "refresh_token_success" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Refresh error:", err);
    auditAuthEvent(req, { action: "refresh_token_failure" });
    clearSessionCookies(res);
    return res.status(401).json({ error: "Session expired" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    await revokeRefreshByCookie(req);
  } catch (err) {
    console.error("Logout revoke error:", err);
  }
  auditAuthEvent(req, { action: "logout" });
  clearSessionCookies(res);
  return res.json({ ok: true });
});

router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "auth" });
});

module.exports = router;
