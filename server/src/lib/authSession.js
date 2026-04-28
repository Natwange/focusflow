const prisma = require("./prisma");
const {
  generateRefreshToken,
  issueAccessToken,
  refreshExpiresAt,
  hashRefreshToken,
} = require("./authTokens");
const {
  setAccessTokenCookie,
  setRefreshTokenCookie,
  clearSessionCookies,
  REFRESH_TOKEN_COOKIE,
} = require("./authCookie");

async function establishSession(res, user) {
  const { plain, hash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      expiresAt: refreshExpiresAt(),
    },
  });
  setAccessTokenCookie(res, issueAccessToken(user));
  setRefreshTokenCookie(res, plain);
}

async function revokeRefreshByCookie(req) {
  const raw = req.cookies?.[REFRESH_TOKEN_COOKIE];
  if (!raw || typeof raw !== "string") return;
  const tokenHash = hashRefreshToken(raw);
  await prisma.refreshToken.deleteMany({ where: { tokenHash } });
}

/**
 * Validates refresh cookie, deletes old row (rotation), issues new refresh + access cookies.
 * On any failure clears session cookies (force logout for this client).
 */
async function rotateRefreshSession(req, res) {
  const raw = req.cookies?.[REFRESH_TOKEN_COOKIE];
  if (!raw || typeof raw !== "string") {
    clearSessionCookies(res);
    return false;
  }

  const presentedHash = hashRefreshToken(raw);

  const rotated = await prisma.$transaction(async (tx) => {
    const row = await tx.refreshToken.findUnique({
      where: { tokenHash: presentedHash },
    });
    if (!row || row.expiresAt < new Date()) {
      return null;
    }

    await tx.refreshToken.delete({ where: { id: row.id } });

    const user = await tx.user.findUnique({
      where: { id: row.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) return null;

    const { plain, hash } = generateRefreshToken();
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: refreshExpiresAt(),
      },
    });

    return { user, refreshPlain: plain };
  });

  if (!rotated) {
    clearSessionCookies(res);
    return false;
  }

  setAccessTokenCookie(res, issueAccessToken(rotated.user));
  setRefreshTokenCookie(res, rotated.refreshPlain);
  return true;
}

module.exports = {
  establishSession,
  revokeRefreshByCookie,
  rotateRefreshSession,
};
