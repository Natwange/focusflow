const express = require("express");
const bcrypt = require("bcrypt");
const prisma = require("../lib/prisma");
const jwt = require("jsonwebtoken");

const router = express.Router();

// POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    // basic validation
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // check if user exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Email is already in use" });
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // create user
    const user = await prisma.user.create({
      data: { email, password: hashedPassword },
      select: { id: true, email: true, createdAt: true },
    });

    return res.status(201).json(user);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not set in server .env");
      return res.status(500).json({
        error: "Server misconfiguration: JWT_SECRET is not set. Add JWT_SECRET to server/.env",
      });
    }

    const { email, password } = req.body;

    // validation
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // find user
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // verify password
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // create token (this is the "wristband")
    const token = jwt.sign(
      { sub: user.id, email: user.email }, // payload
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    const message =
      err.code === "P1001"
        ? "Cannot reach database. Check DATABASE_URL and that Postgres is running."
        : err.message || "Internal server error";
    return res.status(500).json({ error: message });
  }
});

router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "auth" });
});

module.exports = router;
