const {
  resetComposioClientForTests,
  setComposioClientForTests,
  isComposioConfigured,
  executeComposioAction,
} = require("../../src/integrations/composio/composioClient");
const {
  listConnectionStatus,
  startConnect,
  disconnect,
  getActiveConnectedAccountId,
  assertConnectionOwnedByUser,
  completeConnectFromCallback,
  signConnectState,
} = require("../../src/integrations/composio/connectionService");
const { redactSensitive } = require("../../src/integrations/composio/redact");
const { runGmailSendEmail, runGmailCreateDraft } = require("../../src/integrations/composio/gmailTools");
const { runCalendarCreateEvent } = require("../../src/integrations/composio/calendarTools");
const { runNotionCreatePage } = require("../../src/integrations/composio/notionTools");
const { pendingConfirmationToToolCall } = require("../../src/agent/pendingConfirmationResolver");

const mockComposioConnections = new Map();

jest.mock("../../src/lib/prisma", () => ({
  composioConnection: {
    findUnique: jest.fn(async ({ where }) => {
      const key = `${where.userId_toolkit.userId}:${where.userId_toolkit.toolkit}`;
      return mockComposioConnections.get(key) || null;
    }),
    findFirst: jest.fn(async ({ where }) => {
      for (const row of mockComposioConnections.values()) {
        if (where.userId && row.userId !== where.userId) continue;
        if (where.composioAccountId && row.composioAccountId !== where.composioAccountId) {
          continue;
        }
        return row;
      }
      return null;
    }),
    findMany: jest.fn(async ({ where }) => {
      return [...mockComposioConnections.values()].filter((r) => r.userId === where.userId);
    }),
    upsert: jest.fn(async ({ where, create, update }) => {
      const key = `${where.userId_toolkit.userId}:${where.userId_toolkit.toolkit}`;
      const existing = mockComposioConnections.get(key);
      const row = existing ? { ...existing, ...update } : { ...create };
      mockComposioConnections.set(key, row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => {
      const key = `${where.userId_toolkit.userId}:${where.userId_toolkit.toolkit}`;
      const existing = mockComposioConnections.get(key);
      const row = { ...existing, ...data };
      mockComposioConnections.set(key, row);
      return row;
    }),
  },
  goal: {
    findUnique: jest.fn(),
    findMany: jest.fn(async () => []),
  },
  task: {
    findMany: jest.fn(async () => []),
  },
}));

describe("Composio integrations", () => {
  const mockClient = {
    connectedAccounts: {
      link: jest.fn(async () => ({
        redirectUrl: "https://composio.example/oauth",
        connectedAccountId: "ca_test_1",
      })),
      waitForConnection: jest.fn(async () => ({ status: "ACTIVE" })),
      delete: jest.fn(async () => ({})),
    },
    tools: {
      execute: jest.fn(async () => ({ data: { id: "external_1" } })),
    },
  };

  beforeEach(() => {
    mockComposioConnections.clear();
    resetComposioClientForTests();
    setComposioClientForTests(mockClient);
    process.env.COMPOSIO_API_KEY = "cmp_test_key";
    process.env.JWT_SECRET = "test-jwt-secret-for-composio";
    process.env.PUBLIC_API_URL = "https://api.example.com";
    process.env.COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR = "ac_calendar";
    process.env.COMPOSIO_AUTH_CONFIG_GMAIL = "ac_gmail";
    process.env.COMPOSIO_AUTH_CONFIG_NOTION = "ac_notion";
  });

  afterEach(() => {
    resetComposioClientForTests();
    delete process.env.COMPOSIO_API_KEY;
  });

  test("isComposioConfigured when API key set", () => {
    expect(isComposioConfigured()).toBe(true);
  });

  test("startConnect returns redirect URL and stores pending connection", async () => {
    const result = await startConnect("user_1", "gmail");
    expect(result.ok).toBe(true);
    expect(result.redirectUrl).toMatch(/composio/);
    expect(mockClient.connectedAccounts.link).toHaveBeenCalled();
    const status = await listConnectionStatus("user_1");
    expect(status.find((s) => s.toolkit === "gmail")?.status).toBe("pending");
  });

  test("disconnect marks connection disconnected", async () => {
    mockComposioConnections.set("user_1:gmail", {
      userId: "user_1",
      toolkit: "gmail",
      status: "active",
      composioAccountId: "ca_test_1",
    });
    const result = await disconnect("user_1", "gmail");
    expect(result.ok).toBe(true);
    expect(mockClient.connectedAccounts.delete).toHaveBeenCalledWith("ca_test_1");
  });

  test("status lists supported toolkits", async () => {
    const status = await listConnectionStatus("user_1");
    expect(status.map((s) => s.toolkit)).toEqual(
      expect.arrayContaining(["googlecalendar", "gmail", "notion"])
    );
  });

  test("gmail send requires confirmation before execute", async () => {
    mockComposioConnections.set("user_1:gmail", {
      userId: "user_1",
      toolkit: "gmail",
      status: "active",
      composioAccountId: "ca_gmail",
    });

    const preview = await runGmailSendEmail("user_1", {
      to: "me@example.com",
      subject: "Plan",
      body: "Weekly plan",
    });
    expect(preview.ok).toBe(true);
    expect(preview.data.pendingConfirmation.type).toBe("gmail_send_email");
    expect(mockClient.tools.execute).not.toHaveBeenCalled();

    const confirmed = await runGmailSendEmail("user_1", {
      to: "me@example.com",
      subject: "Plan",
      body: "Weekly plan",
      confirmed: true,
    });
    expect(confirmed.ok).toBe(true);
    expect(mockClient.tools.execute).toHaveBeenCalled();
  });

  test("gmail draft does not require confirmed flag", async () => {
    mockComposioConnections.set("user_1:gmail", {
      userId: "user_1",
      toolkit: "gmail",
      status: "active",
      composioAccountId: "ca_gmail",
    });

    const result = await runGmailCreateDraft("user_1", {
      to: "me@example.com",
      subject: "Draft",
      body: "Body",
    });
    expect(result.ok).toBe(true);
    expect(mockClient.tools.execute).toHaveBeenCalled();
  });

  test("calendar create previews without confirmed", async () => {
    mockComposioConnections.set("user_1:googlecalendar", {
      userId: "user_1",
      toolkit: "googlecalendar",
      status: "active",
      composioAccountId: "ca_cal",
    });

    const result = await runCalendarCreateEvent("user_1", {
      summary: "DSA study",
      startTime: "2026-06-24T09:00:00.000Z",
      endTime: "2026-06-24T10:00:00.000Z",
    });
    expect(result.data.pendingConfirmation.type).toBe("calendar_create_event");
    expect(mockClient.tools.execute).not.toHaveBeenCalled();
  });

  test("notion create page previews without confirmed", async () => {
    mockComposioConnections.set("user_1:notion", {
      userId: "user_1",
      toolkit: "notion",
      status: "active",
      composioAccountId: "ca_notion",
    });

    const result = await runNotionCreatePage("user_1", {
      title: "Study dashboard",
      content: "# Dashboard",
    });
    expect(result.data.pendingConfirmation.type).toBe("notion_create_page");
    expect(mockClient.tools.execute).not.toHaveBeenCalled();
  });

  test("cross-user connection ownership check", async () => {
    mockComposioConnections.set("user_1:gmail", {
      userId: "user_1",
      toolkit: "gmail",
      status: "active",
      composioAccountId: "ca_owned",
    });
    expect(await assertConnectionOwnedByUser("user_1", "ca_owned")).toBe(true);
    expect(await assertConnectionOwnedByUser("user_2", "ca_owned")).toBe(false);
    expect(await getActiveConnectedAccountId("user_2", "gmail")).toBeNull();
  });

  test("token redaction removes sensitive fields", () => {
    const redacted = redactSensitive({
      access_token: "secret",
      summary: "ok",
      nested: { refresh_token: "abc", title: "page" },
    });
    expect(redacted.access_token).toBe("[REDACTED]");
    expect(redacted.nested.refresh_token).toBe("[REDACTED]");
    expect(redacted.summary).toBe("ok");
  });

  test("Composio unavailable returns graceful fallback", async () => {
    resetComposioClientForTests();
    delete process.env.COMPOSIO_API_KEY;

    const result = await executeComposioAction(
      "user_1",
      "gmail",
      "GMAIL_SEND_EMAIL",
      {},
      { connectedAccountId: "ca_x" }
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/unavailable|not configured/i);
  });

  test("pending confirmation maps gmail send approval", () => {
    const call = pendingConfirmationToToolCall({
      type: "gmail_send_email",
      to: "a@b.com",
      subject: "Hi",
      body: "Body",
    });
    expect(call.toolName).toBe("gmail_send_email");
    expect(call.toolArgs.confirmed).toBe(true);
  });

  test("complete connect from callback activates toolkit", async () => {
    const state = signConnectState("user_1", "notion");
    const result = await completeConnectFromCallback({
      state,
      connectedAccountId: "ca_notion_new",
    });
    expect(result.ok).toBe(true);
    expect(result.toolkit).toBe("notion");
    const accountId = await getActiveConnectedAccountId("user_1", "notion");
    expect(accountId).toBe("ca_notion_new");
  });
});
