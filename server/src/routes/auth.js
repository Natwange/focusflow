const express = require("express");
const bcrypt = require("bcrypt");
const { OpaqueTokenPurpose } = require("@prisma/client");
const prisma = require("../lib/prisma");
const { prismaErrorMessage } = require("../lib/prismaErrors");
const { clearSessionCookies } = require("../lib/authCookie");
const { auditAuthEvent } = require("../lib/auditLogger");
const {
  establishSession,
  revokeRefreshByCookie,
  rotateRefreshSession,
} = require("../lib/authSession");
const {
  generateOpaqueToken,
  hashOpaqueToken,
  passwordResetExpiresAt,
  emailVerificationExpiresAt,
} = require("../lib/opaqueToken");
const {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} = require("../lib/sendEmail");
const authMiddleware = require("../middleware/auth");
const { validateBody } = require("../middleware/validateBody");
const {
  registerBodySchema,
  loginBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  verifyEmailBodySchema,
} = require("../validation/schemas");

const router = express.Router();

const genericForgotPasswordMessage = {
  message:
    "If an account exists for that email, we sent password reset instructions.",
};

async function createEmailVerificationToken(userId) {
  const { plain, hash } = generateOpaqueToken();
  await prisma.opaqueAuthToken.deleteMany({
    where: { userId, purpose: OpaqueTokenPurpose.EMAIL_VERIFY },
  });
  await prisma.opaqueAuthToken.create({
    data: {
      userId,
      purpose: OpaqueTokenPurpose.EMAIL_VERIFY,
      tokenHash: hash,
      expiresAt: emailVerificationExpiresAt(),
    },
  });
  return plain;
}

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
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        emailVerifiedAt: true,
      },
    });

    try {
      const verifyPlain = await createEmailVerificationToken(user.id);
      await sendEmailVerificationEmail(user.email, verifyPlain);
    } catch (err) {
      console.error("Verification email error:", err);
    }

    return res.status(201).json({
      message: "Account created. Sign in with your email and password.",
      user: {
        ...user,
        emailVerified: Boolean(user.emailVerifiedAt),
      },
    });
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
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        emailVerifiedAt: true,
      },
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
        emailVerifiedAt: user.emailVerifiedAt,
        emailVerified: Boolean(user.emailVerifiedAt),
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

// POST /auth/forgot-password — always same response shape (no email enumeration).
router.post(
  "/forgot-password",
  validateBody(forgotPasswordBodySchema),
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true },
      });
      if (user) {
        const { plain, hash } = generateOpaqueToken();
        await prisma.opaqueAuthToken.deleteMany({
          where: { userId: user.id, purpose: OpaqueTokenPurpose.PASSWORD_RESET },
        });
        await prisma.opaqueAuthToken.create({
          data: {
            userId: user.id,
            purpose: OpaqueTokenPurpose.PASSWORD_RESET,
            tokenHash: hash,
            expiresAt: passwordResetExpiresAt(),
          },
        });
        try {
          await sendPasswordResetEmail(user.email, plain);
        } catch (err) {
          console.error("Password reset email error:", err);
        }
      }
      return res.json(genericForgotPasswordMessage);
    } catch (err) {
      console.error("Forgot password error:", err);
      return res.status(500).json({ error: prismaErrorMessage(err) });
    }
  }
);

// POST /auth/reset-password
router.post(
  "/reset-password",
  validateBody(resetPasswordBodySchema),
  async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      const tokenHash = hashOpaqueToken(token);

      const result = await prisma.$transaction(async (tx) => {
        const row = await tx.opaqueAuthToken.findUnique({
          where: { tokenHash },
        });
        if (
          !row ||
          row.purpose !== OpaqueTokenPurpose.PASSWORD_RESET ||
          row.usedAt ||
          row.expiresAt < new Date()
        ) {
          return { ok: false };
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await tx.user.update({
          where: { id: row.userId },
          data: { password: hashed },
        });
        await tx.opaqueAuthToken.update({
          where: { id: row.id },
          data: { usedAt: new Date() },
        });
        await tx.refreshToken.deleteMany({ where: { userId: row.userId } });
        return { ok: true };
      });

      if (!result.ok) {
        return res.status(400).json({
          error: "This reset link is invalid or has expired. Request a new one.",
        });
      }

      auditAuthEvent(req, { action: "password_reset_completed" });
      return res.json({ ok: true, message: "Password updated. You can sign in." });
    } catch (err) {
      console.error("Reset password error:", err);
      return res.status(500).json({ error: prismaErrorMessage(err) });
    }
  }
);

// POST /auth/verify-email
router.post(
  "/verify-email",
  validateBody(verifyEmailBodySchema),
  async (req, res) => {
    try {
      const { token } = req.body;
      const tokenHash = hashOpaqueToken(token);

      const result = await prisma.$transaction(async (tx) => {
        const row = await tx.opaqueAuthToken.findUnique({
          where: { tokenHash },
        });
        if (
          !row ||
          row.purpose !== OpaqueTokenPurpose.EMAIL_VERIFY ||
          row.usedAt ||
          row.expiresAt < new Date()
        ) {
          return { ok: false };
        }

        await tx.user.update({
          where: { id: row.userId },
          data: { emailVerifiedAt: new Date() },
        });
        await tx.opaqueAuthToken.deleteMany({
          where: {
            userId: row.userId,
            purpose: OpaqueTokenPurpose.EMAIL_VERIFY,
          },
        });
        return { ok: true };
      });

      if (!result.ok) {
        return res.status(400).json({
          error:
            "This verification link is invalid or has expired. Sign in and resend verification from settings.",
        });
      }

      return res.json({ ok: true, message: "Email verified." });
    } catch (err) {
      console.error("Verify email error:", err);
      return res.status(500).json({ error: prismaErrorMessage(err) });
    }
  }
);

// POST /auth/resend-verification-email — must be logged in
router.post("/resend-verification-email", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.emailVerifiedAt) {
      return res.status(400).json({ error: "Email is already verified." });
    }
    const plain = await createEmailVerificationToken(user.id);
    await sendEmailVerificationEmail(user.email, plain);
    return res.json({
      ok: true,
      message: "Verification email sent. Check your inbox.",
    });
  } catch (err) {
    console.error("Resend verification error:", err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

module.exports = router;
