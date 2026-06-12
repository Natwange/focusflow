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

const router = express.Router();

// POST /tasks
router.post("/", validateBody(taskCreateBodySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, goalId, estimatedMin, dueDate, priority } = req.body;
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
  try {
    const userId = req.user.id;
    const { status, goalId, startDate, endDate, includeOverdue } = req.query;

    const where = { userId };
    if (status) where.status = String(status);
    if (goalId) where.goalId = String(goalId);

    if (startDate || endDate) {
      where.dueDate = {};
      const includeOver = String(includeOverdue) === "true";
      if (startDate) where.dueDate.gte = new Date(startDate);
      if (endDate) {
        // Client sends end-of-day as ISO (local day boundary). Do not re-set hours
        // in server TZ — that widens/narrows the window vs the user's calendar day.
        where.dueDate.lte = new Date(endDate);
      }
      // If includeOverdue is enabled, ignore the gte filter and only respect lte.
      // This is used to show overdue tasks in the "today" list.
      if (includeOver) delete where.dueDate.gte;
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    });

    return res.json(tasks);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
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
    const { title, dueDate, estimatedMin, goalId, status, priority } = req.body;

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
      select: { id: true, title: true, status: true, completedAt: true, dueDate: true },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
