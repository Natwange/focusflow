const prisma = require("./prisma");
const { findOwnedResource } = require("./ownershipAssert");
const { sanitizeUserText } = require("./sanitizeInput");
const { validateTaskScheduleFields, parseOptionalScheduleDate } = require("./taskSchedule");

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
  { title, goalId, estimatedMin, dueDate, priority, startTime, endTime }
) {
  const scheduleCheck = validateTaskScheduleFields({ startTime, endTime });
  if (!scheduleCheck.ok) {
    const err = new Error(scheduleCheck.error);
    err.code = "VALIDATION";
    throw err;
  }

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
      startTime: startTime ? new Date(startTime) : null,
      endTime: endTime ? new Date(endTime) : null,
    },
  });
}

/**
 * Update allowed fields on a task (already ownership-checked).
 */
async function updateTaskForUser(
  taskId,
  { title, dueDate, status, startTime, endTime }
) {
  const scheduleCheck = validateTaskScheduleFields({ startTime, endTime });
  if (!scheduleCheck.ok) {
    const err = new Error(scheduleCheck.error);
    err.code = "VALIDATION";
    throw err;
  }

  const data = {};
  if (title !== undefined) data.title = sanitizeUserText(title);
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  if (startTime !== undefined) {
    const parsed = parseOptionalScheduleDate(startTime);
    if (parsed !== undefined) data.startTime = parsed;
  }
  if (endTime !== undefined) {
    const parsed = parseOptionalScheduleDate(endTime);
    if (parsed !== undefined) data.endTime = parsed;
  }
  if (status !== undefined) {
    data.status = String(status);
    if (status === "done") data.completedAt = new Date();
  }
  return prisma.task.update({ where: { id: taskId }, data });
}

/**
 * Delete a task (already ownership-checked).
 */
async function deleteTaskForUser(taskId) {
  return prisma.task.delete({ where: { id: taskId } });
}

module.exports = { listTasksForUser, createTaskForUser, updateTaskForUser, deleteTaskForUser };
