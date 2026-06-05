const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const authRoutes = require("./routes/auth");
const prisma = require("./lib/prisma");
const { prismaErrorMessage } = require("./lib/prismaErrors");
const { auditAuthEvent } = require("./lib/auditLogger");

const auth = require("./middleware/auth");
const goalRoutes = require("./routes/goals");
const taskRoutes = require("./routes/tasks");
const analyticsRoutes = require("./routes/analytics");
const journalRoutes = require("./routes/journal");
const focusRoutes = require("./routes/focus");
const activityRoutes = require("./routes/activity");
const agentRoutes = require("./routes/agent");

function createApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === "production";

  const clientOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const clientIpKey = (req) => {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      return xff.split(",")[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
  };

  const rateLimitOpts = {
    windowMs: 60 * 1000,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientIpKey,
  };

  // Brute-force protection for credential endpoints (login, register, password flows).
  const authSensitiveLimiter = rateLimit({
    ...rateLimitOpts,
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
    message: { error: "Too many auth requests, please try again shortly." },
  });

  // Looser limit for token refresh — separate bucket so refresh retries don't block login.
  const authRefreshLimiter = rateLimit({
    ...rateLimitOpts,
    max: Number(process.env.AUTH_REFRESH_RATE_LIMIT_MAX || 60),
    message: { error: "Too many refresh requests, please try again shortly." },
  });

  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (clientOrigins.includes(origin)) return callback(null, true);
        const err = new Error("CORS origin not allowed");
        err.status = 403;
        return callback(err);
      },
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "50kb" }));
  app.use(express.urlencoded({ extended: true, limit: "50kb" }));

  app.use("/auth/login", authSensitiveLimiter);
  app.use("/auth/register", authSensitiveLimiter);
  app.use("/auth/forgot-password", authSensitiveLimiter);
  app.use("/auth/reset-password", authSensitiveLimiter);
  app.use("/auth/verify-email", authSensitiveLimiter);
  app.use("/auth/resend-verification-email", authSensitiveLimiter);
  app.use("/auth/refresh", authRefreshLimiter);

  app.use("/auth", authRoutes);
  app.use("/goals", auth, goalRoutes);
  app.use("/tasks", auth, taskRoutes);
  app.use("/analytics", auth, analyticsRoutes);
  app.use("/journal", auth, journalRoutes);
  app.use("/focus", auth, focusRoutes);
  app.use("/activity", auth, activityRoutes);
  app.use("/agent", auth, agentRoutes);

  app.get("/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.get("/me", auth, async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, email: true, name: true, emailVerifiedAt: true },
      });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      return res.json({
        user: {
          ...user,
          emailVerified: Boolean(user.emailVerifiedAt),
        },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: prismaErrorMessage(err) });
    }
  });

  app.patch("/me/password", auth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: "currentPassword and newPassword are required",
        });
      }
      if (typeof newPassword !== "string" || newPassword.length < 8) {
        return res.status(400).json({
          error: "New password must be at least 8 characters",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { password: true, email: true },
      });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const ok = await bcrypt.compare(currentPassword, user.password);
      if (!ok) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: req.user.id },
        data: { password: hashed },
      });
      auditAuthEvent(req, {
        action: "password_change",
        userId: req.user.id,
        email: user.email || null,
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: prismaErrorMessage(err) });
    }
  });

  app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    if (res.headersSent) return next(err);

    const status = Number(err?.status || err?.statusCode || 500);
    const message =
      !isProduction && err?.message
        ? err.message
        : "Internal server error";

    return res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
