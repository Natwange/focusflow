const jwt = require("jsonwebtoken");
const prisma = require("../../lib/prisma");
const {
  getComposioClient,
  getAuthConfigId,
  getPublicApiBase,
  composioUserId,
  isComposioConfigured,
} = require("./composioClient");
const { isSupportedToolkit, SUPPORTED_TOOLKITS } = require("./composioToolSlugs");

function signConnectState(userId, toolkit) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required for Composio connect state.");
  }
  return jwt.sign({ userId, toolkit, purpose: "composio_connect" }, process.env.JWT_SECRET, {
    expiresIn: "20m",
  });
}

function verifyConnectState(state) {
  if (!process.env.JWT_SECRET) return null;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET);
    if (payload?.purpose !== "composio_connect") return null;
    if (!payload?.userId || !payload?.toolkit) return null;
    return payload;
  } catch {
    return null;
  }
}

async function getConnectionRecord(userId, toolkit) {
  return prisma.composioConnection.findUnique({
    where: { userId_toolkit: { userId, toolkit } },
  });
}

async function assertConnectionOwnedByUser(userId, composioAccountId) {
  const row = await prisma.composioConnection.findFirst({
    where: { userId, composioAccountId },
  });
  return Boolean(row);
}

async function getActiveConnectedAccountId(userId, toolkit) {
  const row = await getConnectionRecord(userId, toolkit);
  if (!row || row.status !== "active" || !row.composioAccountId) {
    return null;
  }
  return row.composioAccountId;
}

async function listConnectionStatus(userId) {
  const rows = await prisma.composioConnection.findMany({
    where: { userId },
  });
  const byToolkit = new Map(rows.map((r) => [r.toolkit, r]));

  return SUPPORTED_TOOLKITS.map((toolkit) => {
    const row = byToolkit.get(toolkit);
    return {
      toolkit,
      status: row?.status ?? "disconnected",
      connectedAt: row?.connectedAt ?? null,
      composioConfigured: isComposioConfigured(),
      authConfigConfigured: Boolean(getAuthConfigId(toolkit)),
    };
  });
}

async function startConnect(userId, toolkit) {
  if (!isSupportedToolkit(toolkit)) {
    return { ok: false, error: "Unsupported toolkit." };
  }
  if (!isComposioConfigured()) {
    return {
      ok: false,
      error: "Composio is not configured.",
      summary: "External integrations are unavailable on this server.",
    };
  }

  const authConfigId = getAuthConfigId(toolkit);
  if (!authConfigId) {
    return {
      ok: false,
      error: `Auth config missing for ${toolkit}.`,
      summary: `Server is missing COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase()}.`,
    };
  }

  const client = await getComposioClient();
  const state = signConnectState(userId, toolkit);
  const apiBase = getPublicApiBase();
  if (!apiBase) {
    return {
      ok: false,
      error: "PUBLIC_API_URL is not configured.",
      summary: "Cannot start OAuth — set PUBLIC_API_URL on the API service.",
    };
  }

  const callbackUrl = `${apiBase}/integrations/composio/callback?state=${encodeURIComponent(state)}`;

  const link = await client.connectedAccounts.link(
    composioUserId(userId),
    authConfigId,
    { callbackUrl }
  );

  const connectedAccountId =
    link?.connectedAccountId || link?.id || link?.connected_account_id || null;
  const redirectUrl =
    link?.redirectUrl || link?.redirect_url || link?.url || null;

  if (!redirectUrl) {
    return { ok: false, error: "Composio did not return a redirect URL." };
  }

  await prisma.composioConnection.upsert({
    where: { userId_toolkit: { userId, toolkit } },
    create: {
      userId,
      toolkit,
      status: "pending",
      composioAccountId: connectedAccountId,
    },
    update: {
      status: "pending",
      composioAccountId: connectedAccountId,
      disconnectedAt: null,
    },
  });

  return {
    ok: true,
    redirectUrl,
    toolkit,
    status: "pending",
  };
}

async function completeConnectFromCallback({ state, connectedAccountId }) {
  const payload = verifyConnectState(state);
  if (!payload) {
    return { ok: false, error: "Invalid or expired connect state." };
  }

  const { userId, toolkit } = payload;
  if (!isSupportedToolkit(toolkit)) {
    return { ok: false, error: "Unsupported toolkit in state." };
  }

  const client = await getComposioClient();
  if (!client) {
    return { ok: false, error: "Composio is not configured." };
  }

  let accountId = connectedAccountId;
  if (!accountId) {
    const row = await getConnectionRecord(userId, toolkit);
    accountId = row?.composioAccountId;
  }

  if (!accountId) {
    return { ok: false, error: "Missing connected account id." };
  }

  try {
    await client.connectedAccounts.waitForConnection(accountId, 90_000);
  } catch (err) {
    await prisma.composioConnection.update({
      where: { userId_toolkit: { userId, toolkit } },
      data: { status: "failed" },
    });
    return { ok: false, error: err?.message || "Connection failed." };
  }

  await prisma.composioConnection.upsert({
    where: { userId_toolkit: { userId, toolkit } },
    create: {
      userId,
      toolkit,
      status: "active",
      composioAccountId: accountId,
      connectedAt: new Date(),
    },
    update: {
      status: "active",
      composioAccountId: accountId,
      connectedAt: new Date(),
      disconnectedAt: null,
    },
  });

  return { ok: true, toolkit, status: "active" };
}

async function disconnect(userId, toolkit) {
  if (!isSupportedToolkit(toolkit)) {
    return { ok: false, error: "Unsupported toolkit." };
  }

  const row = await getConnectionRecord(userId, toolkit);
  if (!row?.composioAccountId) {
    await prisma.composioConnection.upsert({
      where: { userId_toolkit: { userId, toolkit } },
      create: { userId, toolkit, status: "disconnected", disconnectedAt: new Date() },
      update: { status: "disconnected", disconnectedAt: new Date() },
    });
    return { ok: true, toolkit, status: "disconnected" };
  }

  if (isComposioConfigured()) {
    try {
      const client = await getComposioClient();
      await client.connectedAccounts.delete(row.composioAccountId);
    } catch (err) {
      console.warn("Composio disconnect warning:", err.message);
    }
  }

  await prisma.composioConnection.update({
    where: { userId_toolkit: { userId, toolkit } },
    data: {
      status: "disconnected",
      disconnectedAt: new Date(),
    },
  });

  return { ok: true, toolkit, status: "disconnected" };
}

module.exports = {
  listConnectionStatus,
  startConnect,
  completeConnectFromCallback,
  disconnect,
  getActiveConnectedAccountId,
  assertConnectionOwnedByUser,
  verifyConnectState,
  signConnectState,
};
