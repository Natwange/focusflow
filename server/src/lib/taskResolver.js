const prisma = require("./prisma");

/**
 * @typedef {object} ResolveResult
 * @property {boolean} ok
 * @property {object|null} task
 * @property {string|null} error
 * @property {"not_found"|"forbidden"|"ambiguous"|null} code
 * @property {Array<{id:string,title:string}>} [matches]
 */

/**
 * Resolve a task by exact ID or title match, scoped to userId.
 *
 * @param {string} userId
 * @param {{ taskId?: string, taskTitle?: string }} lookup
 * @returns {Promise<ResolveResult>}
 */
async function resolveTask(userId, { taskId, taskTitle }) {
  if (taskId) {
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return { ok: false, task: null, error: "Task not found.", code: "not_found" };
    }
    if (String(task.userId) !== String(userId)) {
      return { ok: false, task: null, error: "Task does not belong to you.", code: "forbidden" };
    }
    return { ok: true, task, error: null, code: null };
  }

  if (!taskTitle || typeof taskTitle !== "string" || !taskTitle.trim()) {
    return { ok: false, task: null, error: "Provide a task ID or title to identify the task.", code: "not_found" };
  }

  const title = taskTitle.trim();

  // Exact match first
  const exact = await prisma.task.findMany({
    where: { userId, title },
  });
  if (exact.length === 1) {
    return { ok: true, task: exact[0], error: null, code: null };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      task: null,
      error: `Multiple tasks match "${title}". Please be more specific or provide the task ID.`,
      code: "ambiguous",
      matches: exact.map((t) => ({ id: t.id, title: t.title })),
    };
  }

  // Case-insensitive contains (full phrase)
  const fuzzy = await prisma.task.findMany({
    where: {
      userId,
      title: { contains: title, mode: "insensitive" },
    },
  });

  if (fuzzy.length === 1) {
    return { ok: true, task: fuzzy[0], error: null, code: null };
  }
  if (fuzzy.length > 1) {
    return {
      ok: false,
      task: null,
      error: `Multiple tasks match "${title}": ${fuzzy.map((t) => `"${t.title}"`).join(", ")}. Which one do you mean?`,
      code: "ambiguous",
      matches: fuzzy.map((t) => ({ id: t.id, title: t.title })),
    };
  }

  // Word-level fallback: try matching individual significant words (3+ chars)
  const words = title.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length > 0) {
    const allUserTasks = await prisma.task.findMany({ where: { userId } });
    const scored = allUserTasks
      .map((t) => {
        const lower = t.title.toLowerCase();
        const hits = words.filter((w) => lower.includes(w.toLowerCase())).length;
        return { task: t, hits };
      })
      .filter((s) => s.hits > 0)
      .sort((a, b) => b.hits - a.hits);

    if (scored.length === 1) {
      return { ok: true, task: scored[0].task, error: null, code: null };
    }
    if (scored.length > 1 && scored[0].hits > scored[1].hits) {
      return { ok: true, task: scored[0].task, error: null, code: null };
    }
    if (scored.length > 1) {
      return {
        ok: false,
        task: null,
        error: `Multiple tasks could match "${title}": ${scored.slice(0, 5).map((s) => `"${s.task.title}"`).join(", ")}. Which one do you mean?`,
        code: "ambiguous",
        matches: scored.slice(0, 5).map((s) => ({ id: s.task.id, title: s.task.title })),
      };
    }
  }

  return { ok: false, task: null, error: `No task found matching "${title}".`, code: "not_found" };
}

module.exports = { resolveTask };
