const express = require("express");
const bcrypt = require("bcrypt");
const prisma = require("../lib/prisma");
const { prismaErrorMessage } = require("../lib/prismaErrors");
const { clearSessionCookies } = require("../lib/authCookie");
const {
  establishSession,
  revokeRefreshByCookie,
  rotateRefreshSession,
} = require("../lib/authSession");

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
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const trimmedName =
      typeof name === "string" ? name.trim().slice(0, 120) : "";
    if (!trimmedName) {
      return res.status(400).json({ error: "Name is required" });
    }

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
      data: { email, password: hashedPassword, name: trimmedName },
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
router.post("/login", async (req, res) => {
  try {
    if (!requireJwtSecret(res)) return;

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, password: true },
    });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    await establishSession(res, {
      id: user.id,
      email: user.email,
      name: user.name || "",
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
      return res.status(401).json({ error: "Session expired" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Refresh error:", err);
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
  clearSessionCookies(res);
  return res.json({ ok: true });
});

router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "auth" });
});

module.exports = router;
