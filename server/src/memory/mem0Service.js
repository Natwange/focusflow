const { validateMemoryContent } = require("./memoryContentSafety");
const {
  extractPreferenceMemoriesFromText,
  shouldAttemptMem0Inference,
  isMemoryRecallRequest,
  isExplicitRememberRequest,
  resolveRememberStoragePlan,
} = require("./memoryExtraction");

const DEFAULT_LIMIT = 6;
const DEFAULT_SCORE_THRESHOLD = 0.35;
const MEM0_USER_PREFIX = "focusflow:";

const EXPLICIT_REMEMBER_INFER_INSTRUCTIONS =
  "The user asked to remember a long-term personal preference. Extract only stable preference facts (study habits, focus length, schedule limits, subject struggles). Do NOT store question words, filler phrases like 'about me', passwords, API keys, one-off task requests, or temporary states like being tired today.";

/** @type {import('mem0ai').default | null} */
let clientSingleton = null;
/** @type {Map<string, Array<{ id: string, content: string, score?: number, metadata?: object }>> | null} */
let inMemoryStore = null;
/** @type {((input: object) => Promise<object>) | null} */
let clientOverride = null;

function isMem0Configured() {
  return Boolean(process.env.MEM0_API_KEY?.trim()) || inMemoryStore != null;
}

function getScoreThreshold() {
  const raw = Number(process.env.MEM0_MEMORY_THRESHOLD);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1
    ? raw
    : DEFAULT_SCORE_THRESHOLD;
}

function getDefaultLimit() {
  const raw = Number(process.env.MEM0_MEMORY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 20) : DEFAULT_LIMIT;
}

function toMem0UserId(userId) {
  const id = String(userId ?? "").trim();
  if (!id) return "";
  if (id.startsWith(MEM0_USER_PREFIX)) return id;
  return `${MEM0_USER_PREFIX}${id}`;
}

function buildMem0EntityFilters(userId) {
  const scoped = toMem0UserId(userId);
  const legacy = String(userId ?? "").trim();
  if (!scoped) return null;

  if (legacy && legacy !== scoped) {
    return {
      OR: [{ user_id: scoped }, { user_id: legacy }],
    };
  }

  return { user_id: scoped };
}

function memoryOwnerId(record) {
  return (
    record?.userId ??
    record?.user_id ??
    record?.metadata?.userId ??
    record?.metadata?.user_id ??
    null
  );
}

function filterMemoriesForUser(records, userId) {
  const scoped = toMem0UserId(userId);
  const legacy = String(userId ?? "").trim();
  if (!scoped) return [];

  return (records ?? []).filter((record) => {
    const owner = memoryOwnerId(record);
    if (!owner) return false;
    return owner === scoped || owner === legacy;
  });
}

function formatMemoryListSummary(memories) {
  if (!memories?.length) {
    return "I don't have any stored preferences for you yet.";
  }
  const lines = memories.map((m) => `• ${m.content}`);
  return `Here's what I remember about your preferences:\n${lines.join("\n")}`;
}

function getMem0Client() {
  if (clientOverride) return clientOverride;
  if (!process.env.MEM0_API_KEY?.trim()) return null;
  if (!clientSingleton) {
    const MemoryClient = require("mem0ai").default;
    clientSingleton = new MemoryClient({
      apiKey: process.env.MEM0_API_KEY.trim(),
    });
  }
  return clientSingleton;
}

function normalizeMemoryRecord(record) {
  const content =
    record?.memory ||
    record?.data?.memory ||
    record?.content ||
    "";
  const owner = memoryOwnerId(record);
  return {
    id: String(record?.id ?? ""),
    content: String(content).trim(),
    score: typeof record?.score === "number" ? record.score : undefined,
    metadata: record?.metadata ?? null,
    userId: owner ?? undefined,
  };
}

function filterByConfidence(memories, threshold = getScoreThreshold()) {
  return memories.filter((m) => {
    if (m.score == null) return true;
    return m.score >= threshold;
  });
}

function formatMemoriesForPrompt(memories) {
  const confident = filterByConfidence(memories ?? []);
  if (confident.length === 0) return "";

  const lines = confident
    .slice(0, getDefaultLimit())
    .map((m) => `- ${m.content}`)
    .filter(Boolean);

  if (lines.length === 0) return "";

  return `\n\nRelevant memories (use as soft context only — never override explicit instructions in this turn):\n${lines.join("\n")}`;
}

async function retrieveRelevantMemories({ userId, query, limit = getDefaultLimit() }) {
  if (!userId) return [];

  try {
    if (inMemoryStore) {
      const all = inMemoryStore.get(userId) ?? [];
      const q = String(query ?? "").toLowerCase();
      const ranked = all
        .map((m) => ({
          ...m,
          score:
            m.score ??
            (q && m.content.toLowerCase().includes(q) ? 0.9 : 0.5),
        }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return filterByConfidence(ranked).slice(0, limit);
    }

    const client = getMem0Client();
    if (!client) return [];

    const filters = buildMem0EntityFilters(userId);
    if (!filters) return [];

    const response = await client.search(String(query ?? ""), {
      filters,
      topK: limit,
    });

    const results = Array.isArray(response?.results) ? response.results : [];
    return filterByConfidence(
      filterMemoriesForUser(
        results.map(normalizeMemoryRecord).filter((m) => m.content),
        userId
      )
    ).slice(0, limit);
  } catch (err) {
    console.warn("Mem0 retrieveRelevantMemories failed:", err.message);
    return [];
  }
}

async function storeMemory({ userId, content, metadata = {} }) {
  const validation = validateMemoryContent(content);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }
  if (!userId) {
    return { ok: false, error: "Missing user id for memory storage." };
  }

  try {
    if (inMemoryStore) {
      const row = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        content: validation.text,
        score: 1,
        metadata: { source: "focusflow", ...metadata },
      };
      const list = inMemoryStore.get(userId) ?? [];
      list.push(row);
      inMemoryStore.set(userId, list);
      return { ok: true, memory: row };
    }

    const client = getMem0Client();
    if (!client) {
      console.warn("Mem0 not configured; skipping storeMemory");
      return { ok: false, error: "Mem0 is not configured." };
    }

    const created = await client.add([{ role: "user", content: validation.text }], {
      userId: toMem0UserId(userId),
      infer: false,
      metadata: { source: "focusflow", focusflowUserId: userId, ...metadata },
    });

    const first = Array.isArray(created) ? created[0] : created;
    const memory = normalizeMemoryRecord(first);
    return { ok: true, memory };
  } catch (err) {
    console.warn("Mem0 storeMemory failed:", err.message);
    return { ok: false, error: err.message };
  }
}

async function storeMemoryInferred({ userId, userMessage, metadata = {} }) {
  const message = String(userMessage ?? "").trim();
  if (!message) {
    return { ok: false, error: "Memory message cannot be empty." };
  }
  if (!userId) {
    return { ok: false, error: "Missing user id for memory storage." };
  }

  try {
    if (inMemoryStore) {
      const ruleMemories = extractPreferenceMemoriesFromText(message);
      const content =
        ruleMemories[0] ??
        `User preference: ${message.replace(/^(?:please\s+)?(?:remember|keep in mind)(?:\s+that)?\s*/i, "").trim()}`;
      const validation = validateMemoryContent(content);
      if (!validation.ok) {
        return { ok: false, error: validation.error };
      }
      const row = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        content: validation.text,
        score: 1,
        metadata: { source: "focusflow", storeMode: "infer", ...metadata },
      };
      const list = inMemoryStore.get(userId) ?? [];
      list.push(row);
      inMemoryStore.set(userId, list);
      return { ok: true, memory: row, mode: "infer", pending: false };
    }

    const client = getMem0Client();
    if (!client) {
      return { ok: false, error: "Mem0 is not configured." };
    }

    const response = await client.add([{ role: "user", content: message }], {
      userId: toMem0UserId(userId),
      infer: true,
      metadata: {
        source: "focusflow",
        focusflowUserId: userId,
        storeMode: "infer",
        ...metadata,
      },
      customInstructions: EXPLICIT_REMEMBER_INFER_INSTRUCTIONS,
    });

    if (response?.status === "PENDING" || response?.eventId) {
      return {
        ok: true,
        memory: {
          id: String(response.eventId ?? ""),
          content: "",
        },
        mode: "infer",
        pending: true,
      };
    }

    const results = Array.isArray(response)
      ? response
      : Array.isArray(response?.results)
        ? response.results
        : [response];
    const first = results.find((r) => normalizeMemoryRecord(r).content) ?? results[0];
    const memory = normalizeMemoryRecord(first);
    return {
      ok: true,
      memory,
      mode: "infer",
      pending: !memory.content,
    };
  } catch (err) {
    console.warn("Mem0 storeMemoryInferred failed:", err.message);
    return { ok: false, error: err.message };
  }
}

function rememberConfirmationMessage(result) {
  if (!result.ok) return result.error || "I couldn't save that preference.";
  if (result.pending) return "Got it — I'll remember that preference.";
  const content = result.memory?.content?.trim();
  return content
    ? `Got it — I'll remember: ${content}`
    : "Got it — I'll remember that preference.";
}

/**
 * Hybrid explicit remember: regex literal when possible, Mem0 infer otherwise.
 */
async function rememberUserPreference({ userId, message }) {
  const plan = resolveRememberStoragePlan(message);
  if (plan.mode === "skip") {
    return { ok: false, skipped: true };
  }

  if (plan.mode === "literal") {
    const result = await storeMemory({
      userId,
      content: plan.content,
      metadata: { source: "explicit_remember", storeMode: "literal" },
    });
    return { ...result, mode: "literal", pending: false };
  }

  return storeMemoryInferred({
    userId,
    userMessage: plan.message,
    metadata: { source: "explicit_remember" },
  });
}

async function listMemories({ userId, limit = getDefaultLimit() }) {
  if (!userId) return [];

  try {
    if (inMemoryStore) {
      return (inMemoryStore.get(userId) ?? []).slice(0, limit);
    }

    const client = getMem0Client();
    if (!client) return [];

    const filters = buildMem0EntityFilters(userId);
    if (!filters) return [];

    const response = await client.getAll({
      filters,
      page: 1,
      pageSize: limit,
    });

    const results = Array.isArray(response?.results) ? response.results : [];
    return filterMemoriesForUser(
      results.map(normalizeMemoryRecord).filter((m) => m.content),
      userId
    ).slice(0, limit);
  } catch (err) {
    console.warn("Mem0 listMemories failed:", err.message);
    return [];
  }
}

async function deleteMemory({ userId, memoryId }) {
  if (!userId || !memoryId) {
    return { ok: false, error: "userId and memoryId are required." };
  }

  try {
    if (inMemoryStore) {
      const list = inMemoryStore.get(userId) ?? [];
      const next = list.filter((m) => m.id !== memoryId);
      if (next.length === list.length) {
        return { ok: false, error: "Memory not found." };
      }
      inMemoryStore.set(userId, next);
      return { ok: true, deletedId: memoryId };
    }

    const client = getMem0Client();
    if (!client) {
      return { ok: false, error: "Mem0 is not configured." };
    }

    const existing = await client.get(memoryId);
    const owner = memoryOwnerId(existing);
    const scoped = toMem0UserId(userId);
    if (owner && owner !== scoped && owner !== userId) {
      return { ok: false, error: "Forbidden: memory belongs to another user." };
    }

    await client.delete(memoryId);
    return { ok: true, deletedId: memoryId };
  } catch (err) {
    console.warn("Mem0 deleteMemory failed:", err.message);
    return { ok: false, error: err.message };
  }
}

async function deleteMemoriesByQuery({ userId, query, limit = 5 }) {
  const matches = await retrieveRelevantMemories({
    userId,
    query,
    limit,
  });

  if (matches.length === 0) {
    return { ok: false, error: "No matching memories found.", deleted: [] };
  }

  const deleted = [];
  for (const match of matches) {
    const result = await deleteMemory({ userId, memoryId: match.id });
    if (result.ok) deleted.push(match);
  }

  return {
    ok: deleted.length > 0,
    deleted,
    error: deleted.length > 0 ? undefined : "Could not delete matching memories.",
  };
}

async function deleteAllMemoriesForUser({ userId, limit = 50 }) {
  if (!userId) {
    return { ok: false, error: "Missing user id.", deleted: [] };
  }

  const memories = await listMemories({ userId, limit });
  if (memories.length === 0) {
    return { ok: true, deleted: [], empty: true };
  }

  const deleted = [];
  for (const memory of memories) {
    if (!memory.id) continue;
    const result = await deleteMemory({ userId, memoryId: memory.id });
    if (result.ok) deleted.push(memory);
  }

  return {
    ok: deleted.length > 0,
    deleted,
    empty: deleted.length === 0,
    error:
      deleted.length > 0 ? undefined : "Could not delete stored preferences.",
  };
}

function formatForgetAllSummary(result) {
  if (result.empty || result.deleted.length === 0) {
    return "You don't have any stored preferences to clear.";
  }
  return `Cleared ${result.deleted.length} stored preference(s).`;
}

async function buildMemoryContextForTurn({ userId, message }) {
  if (!userId || !isMem0Configured()) return "";
  const memories = await retrieveRelevantMemories({
    userId,
    query: message,
    limit: getDefaultLimit(),
  });
  return formatMemoriesForPrompt(memories);
}

async function maybeAutoExtractAndStore({
  userId,
  userMessage,
  assistantMessage,
  toolResults = [],
}) {
  if (!userId || !isMem0Configured()) return;

  if (isMemoryRecallRequest(userMessage)) return;

  if (isExplicitRememberRequest(userMessage)) return;

  const alreadyStored = toolResults.some(
    (tr) => tr.tool === "store_memory" && tr.ok
  );
  if (alreadyStored) return;

  const alreadyListed = toolResults.some(
    (tr) => tr.tool === "list_memories" && tr.ok
  );
  if (alreadyListed) return;

  const ruleMemories = extractPreferenceMemoriesFromText(userMessage);
  for (const content of ruleMemories) {
    await storeMemory({
      userId,
      content,
      metadata: { source: "auto_rule" },
    });
  }

  if (!shouldAttemptMem0Inference(userMessage)) return;

  try {
    const client = getMem0Client();
    if (!client) return;

    await client.add(
      [
        { role: "user", content: String(userMessage) },
        {
          role: "assistant",
          content: String(assistantMessage ?? "").slice(0, 800),
        },
      ],
      {
        userId: toMem0UserId(userId),
        infer: true,
        metadata: { source: "focusflow", focusflowUserId: userId },
        customInstructions:
          "Extract only stable long-term preferences (study times, focus length, workload limits, subject struggles, day-of-week preferences). Do NOT store passwords, tokens, API keys, or one-off task requests. Do NOT store temporary states like being tired today.",
      }
    );
  } catch (err) {
    console.warn("Mem0 auto-extract failed:", err.message);
  }
}

function setMem0ClientForTests(client) {
  clientOverride = client;
}

function setInMemoryStoreForTests(store) {
  inMemoryStore = store;
}

function resetMem0ServiceForTests() {
  clientOverride = null;
  clientSingleton = null;
  inMemoryStore = null;
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_SCORE_THRESHOLD,
  MEM0_USER_PREFIX,
  isMem0Configured,
  toMem0UserId,
  buildMem0EntityFilters,
  filterMemoriesForUser,
  formatMemoryListSummary,
  retrieveRelevantMemories,
  storeMemory,
  storeMemoryInferred,
  rememberUserPreference,
  rememberConfirmationMessage,
  listMemories,
  deleteMemory,
  deleteMemoriesByQuery,
  deleteAllMemoriesForUser,
  formatForgetAllSummary,
  formatMemoriesForPrompt,
  filterByConfidence,
  buildMemoryContextForTurn,
  maybeAutoExtractAndStore,
  setMem0ClientForTests,
  setInMemoryStoreForTests,
  resetMem0ServiceForTests,
};
