const prisma = require("./prisma");

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "my",
  "to",
  "for",
  "and",
  "or",
  "in",
  "on",
  "at",
  "of",
  "with",
  "goal",
  "study",
  "learn",
  "learning",
]);

/**
 * LLMs often slugify goal titles (e.g. "learn-human-anatomy") instead of using real ids.
 *
 * @param {string} id
 * @returns {boolean}
 */
function looksLikeInventedSlug(id) {
  if (!id || typeof id !== "string") return false;
  const s = id.trim().toLowerCase();
  if (isLikelyServerGoalId(s)) return false;
  // Real DB ids in tests/dev often look like goal_1 — not LLM slugs.
  if (/^goal_/i.test(s)) return false;
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)) return true;
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(s) && s.length >= 12) return true;
  return false;
}

/**
 * @param {string} id
 * @returns {boolean}
 */
function isLikelyServerGoalId(id) {
  const s = String(id || "").trim();
  return /^c[a-z0-9]{20,}$/i.test(s);
}

/**
 * @param {string} phrase
 * @returns {string[]}
 */
function significantWords(phrase) {
  return String(phrase || "")
    .toLowerCase()
    .split(/[\s\-_]+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Score how well a user phrase matches a goal title (higher = better).
 *
 * @param {string} userPhrase
 * @param {string} goalTitle
 * @returns {{ score: number, matchedWords: number, totalWords: number }}
 */
function scoreGoalTitleMatch(userPhrase, goalTitle) {
  const phrase = String(userPhrase || "").trim().toLowerCase();
  const title = String(goalTitle || "").trim().toLowerCase();
  if (!phrase || !title) return { score: 0, matchedWords: 0, totalWords: 0 };

  if (title === phrase) {
    return { score: 1000, matchedWords: 1, totalWords: 1 };
  }
  if (title.includes(phrase)) {
    return { score: 500, matchedWords: 1, totalWords: 1 };
  }

  const words = significantWords(phrase);
  if (words.length === 0) {
    return { score: 0, matchedWords: 0, totalWords: 0 };
  }

  const matchedWords = words.filter((w) => title.includes(w)).length;
  const totalWords = words.length;
  const allMatched = matchedWords === totalWords;
  const coverage = matchedWords / totalWords;

  let score = matchedWords * 10;
  if (allMatched) score += 100;
  score += Math.round(coverage * 50);

  return { score, matchedWords, totalWords };
}

/**
 * If the LLM passed a slug or other invented id, rewrite args to use goalTitle instead.
 *
 * @param {{ goalId?: string, goalTitle?: string }} args
 * @returns {{ goalId?: string, goalTitle?: string }}
 */
function normalizeGoalLookupArgs(args) {
  const out = { ...args };
  const id = out.goalId?.trim();
  if (!id || out.goalTitle) return out;

  if (looksLikeInventedSlug(id)) {
    out.goalTitle = id.replace(/[-_]/g, " ");
    delete out.goalId;
    return out;
  }

  return out;
}

/**
 * @typedef {object} ResolveResult
 * @property {boolean} ok
 * @property {object|null} goal
 * @property {string|null} error
 * @property {"not_found"|"forbidden"|"ambiguous"|null} code
 * @property {Array<{id:string,title:string}>} [matches]
 * @property {string} [matchedFrom]
 */

/**
 * Resolve a goal by exact ID or title match, scoped to userId.
 *
 * @param {string} userId
 * @param {{ goalId?: string, goalTitle?: string }} lookup
 * @returns {Promise<ResolveResult>}
 */
async function resolveGoal(userId, lookup, opts = {}) {
  const normalized = normalizeGoalLookupArgs(lookup);
  const { goalId, goalTitle } = normalized;

  if (goalId && !goalTitle) {
    const goal = await prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) {
      return { ok: false, goal: null, error: "Goal not found.", code: "not_found" };
    }
    if (String(goal.userId) !== String(userId)) {
      return { ok: false, goal: null, error: "Goal does not belong to you.", code: "forbidden" };
    }
    return { ok: true, goal, error: null, code: null, matchedFrom: "goalId" };
  }

  if (!goalTitle || typeof goalTitle !== "string" || !goalTitle.trim()) {
    return {
      ok: false,
      goal: null,
      error: "Provide a goal ID or title to identify the goal.",
      code: "not_found",
    };
  }

  const title = goalTitle.trim();

  const exact = await prisma.goal.findMany({
    where: { userId, title },
  });
  if (exact.length === 1) {
    return { ok: true, goal: exact[0], error: null, code: null, matchedFrom: "exactTitle" };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      goal: null,
      error: `Multiple goals match "${title}". Please be more specific or provide the goal ID.`,
      code: "ambiguous",
      matches: exact.map((g) => ({ id: g.id, title: g.title })),
    };
  }

  const fuzzy = await prisma.goal.findMany({
    where: {
      userId,
      title: { contains: title, mode: "insensitive" },
    },
  });

  if (fuzzy.length === 1) {
    return { ok: true, goal: fuzzy[0], error: null, code: null, matchedFrom: "containsTitle" };
  }
  if (fuzzy.length > 1) {
    return {
      ok: false,
      goal: null,
      error: `Multiple goals match "${title}": ${fuzzy.map((g) => `"${g.title}"`).join(", ")}. Which one do you mean?`,
      code: "ambiguous",
      matches: fuzzy.map((g) => ({ id: g.id, title: g.title })),
    };
  }

  const allUserGoals = await prisma.goal.findMany({ where: { userId } });
  const scored = allUserGoals
    .map((g) => {
      const match = scoreGoalTitleMatch(title, g.title);
      return { goal: g, ...match };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.matchedWords - a.matchedWords);

  if (scored.length === 1) {
    return {
      ok: true,
      goal: scored[0].goal,
      error: null,
      code: null,
      matchedFrom: "wordMatch",
    };
  }
  if (scored.length > 1 && scored[0].score > scored[1].score) {
    return {
      ok: true,
      goal: scored[0].goal,
      error: null,
      code: null,
      matchedFrom: "wordMatch",
    };
  }
  if (scored.length > 1) {
    return {
      ok: false,
      goal: null,
      error: `Multiple goals could match "${title}": ${scored.slice(0, 5).map((s) => `"${s.goal.title}"`).join(", ")}. Which one do you mean?`,
      code: "ambiguous",
      matches: scored.slice(0, 5).map((s) => ({ id: s.goal.id, title: s.goal.title })),
    };
  }

  return {
    ok: false,
    goal: null,
    error: `No goal found matching "${title}".`,
    code: "not_found",
  };
}

module.exports = {
  resolveGoal,
  looksLikeInventedSlug,
  isLikelyServerGoalId,
  normalizeGoalLookupArgs,
  scoreGoalTitleMatch,
  significantWords,
};
