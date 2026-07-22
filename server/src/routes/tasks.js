const express = require("express");
const prisma = require("../lib/prisma");
const { requireOwnedResource } = require("../lib/ownership");
const { sanitizeUserText } = require("../lib/sanitizeInput");
const { validateBody } = require("../middleware/validateBody");
const {
  taskCreateBodySchema,
  taskUpdateBodySchema,
  taskStatusBodySchema,
} = require("../validation/schemas");
const { taskMatchesDueDateQuery } = require("../lib/calendarDueDate");

const router = express.Router();

// POST /tasks
router.post("/", validateBody(taskCreateBodySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, goalId, estimatedMin, dueDate, priority, startTime, endTime } = req.body;
    const safeTitle = sanitizeUserText(title);

    if (goalId) {
      const goal = await prisma.goal.findUnique({
        where: { id: goalId },
        select: { id: true, userId: true },
      });
      if (!goal) return res.status(404).json({ error: "Goal not found" });
      if (goal.userId !== userId) {
        return res.status(403).json({ error: "Forbidden: goal does not belong to this user" });
      }
    }

    const task = await prisma.task.create({
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

    return res.status(201).json(task);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /tasks
// Query: status, goalId, startDate, endDate (ISO strings; filter by dueDate inclusive)
router.get("/", async (req, res) => {
  // DRILL 1 (Breadcrumbs): obvious failure — remove this throw when the drill is done
  try {
    const userId = req.user.id;
    const { status, goalId, startDate, endDate, includeOverdue, tzOffsetMinutes } =
      req.query;

    const where = { userId };
    if (status) where.status = String(status);
    if (goalId) where.goalId = String(goalId);

    const tz =
      tzOffsetMinutes != null && Number.isFinite(Number(tzOffsetMinutes))
        ? Number(tzOffsetMinutes)
        : 0;

    const useCalendarFilter = Boolean(startDate || endDate);

    if (!useCalendarFilter) {
      const tasks = await prisma.task.findMany({
        where,
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      });
      return res.json(tasks);
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    });

    const filtered = tasks.filter((task) =>
      taskMatchesDueDateQuery(task, {
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        includeOverdue: String(includeOverdue) === "true",
        tzOffsetMinutes: tz,
      })
    );

    return res.json(filtered);
  } catch (err) {
    console.error(err);
    const message =
      err?.message?.includes("FOCUSFLOW_OUTAGE_TEST")
        ? err.message
        : "Internal server error";
    return res.status(500).json({ error: message });
  }
});

// DELETE /tasks/:id  (delete a single task you own)
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;

    const task = await requireOwnedResource({
      model: prisma.task,
      id: taskId,
      userId,
      res,
      notFoundMessage: "Task not found",
      forbiddenMessage: "Forbidden: task does not belong to this user",
    });
    if (!task) return;

    await prisma.task.delete({ where: { id: taskId } });

    return res.json({ ok: true, deletedTaskId: taskId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /tasks/:id — update task (title, dueDate, estimatedMin, goalId, status)
router.patch("/:id", validateBody(taskUpdateBodySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { title, dueDate, estimatedMin, goalId, status, priority, startTime, endTime } =
      req.body;

    const task = await requireOwnedResource({
      model: prisma.task,
      id: taskId,
      userId,
      res,
      notFoundMessage: "Task not found",
      forbiddenMessage: "Forbidden: task does not belong to this user",
    });
    if (!task) return;

    if (goalId) {
      const goal = await prisma.goal.findUnique({
        where: { id: goalId },
        select: { id: true, userId: true },
      });
      if (!goal) return res.status(404).json({ error: "Goal not found" });
      if (goal.userId !== userId) {
        return res.status(403).json({ error: "Forbidden: goal does not belong to this user" });
      }
    }

    const data = {};
    if (title !== undefined) data.title = sanitizeUserText(title);
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (startTime !== undefined) data.startTime = startTime ? new Date(startTime) : null;
    if (endTime !== undefined) data.endTime = endTime ? new Date(endTime) : null;
    if (estimatedMin !== undefined) data.estimatedMin = estimatedMin != null ? Number(estimatedMin) : null;
    if (goalId !== undefined) data.goalId = goalId || null;
    if (priority !== undefined) {
      data.priority = priority;
    }
    if (status !== undefined) {
      data.status = status;
      data.completedAt = status === "done" ? new Date() : null;
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data,
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /tasks/:id/status
router.patch("/:id/status", validateBody(taskStatusBodySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { status } = req.body;

    const task = await requireOwnedResource({
      model: prisma.task,
      id: taskId,
      userId,
      res,
      notFoundMessage: "Task not found",
      forbiddenMessage: "Forbidden: task does not belong to this user",
    });
    if (!task) return;

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === "done" ? new Date() : null,
      },
      select: {
        id: true,
        title: true,
        status: true,
        completedAt: true,
        dueDate: true,
        startTime: true,
        endTime: true,
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
