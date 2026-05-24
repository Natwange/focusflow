const prisma = require("./prisma");
const { findOwnedResource } = require("./ownershipAssert");
const { sanitizeUserText } = require("./sanitizeInput");

/**
 * Same filters as GET /tasks.
 */
async function listTasksForUser(
  userId,
  { status, goalId, startDate, endDate, includeOverdue = false, excludeDone = false } = {}
) {
  const where = { userId };
  if (status) {
    where.status = String(status);
  } else if (excludeDone === true || String(excludeDone) === "true") {
    where.status = { not: "done" };
  }
  if (goalId) where.goalId = String(goalId);

  if (startDate || endDate) {
    where.dueDate = {};
    const includeOver = includeOverdue === true || String(includeOverdue) === "true";
    if (startDate) where.dueDate.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.dueDate.lte = end;
    }
    if (includeOver) delete where.dueDate.gte;
  }

  return prisma.task.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });
}

/**
 * Same rules as POST /tasks (single create only).
 */
async function createTaskForUser(
  userId,
  { title, goalId, estimatedMin, dueDate, priority }
) {
  const safeTitle = sanitizeUserText(title);

  if (goalId) {
    const owned = await findOwnedResource({
      model: prisma.goal,
      id: goalId,
      userId,
      notFoundMessage: "Goal not found",
      forbiddenMessage: "Forbidden: goal does not belong to this user",
      select: { id: true },
    });
    if (!owned.ok) {
      const err = new Error(owned.error);
      err.code = owned.code;
      throw err;
    }
  }

  return prisma.task.create({
    data: {
      userId,
      goalId: goalId || null,
      title: safeTitle,
      estimatedMin: estimatedMin != null ? Number(estimatedMin) : null,
      priority: priority || "medium",
      dueDate: dueDate ? new Date(dueDate) : null,
    },
  });
}

module.exports = { listTasksForUser, createTaskForUser };
