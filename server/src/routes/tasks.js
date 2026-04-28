const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

// POST /tasks
router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, goalId, estimatedMin, dueDate, priority } = req.body;

    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }

    const allowedPriorities = new Set(["low", "medium", "high", "urgent"]);
    if (priority && !allowedPriorities.has(priority)) {
      return res.status(400).json({ error: "priority must be low, medium, high, or urgent" });
    }

    if (goalId) {
      const goal = await prisma.goal.findFirst({
        where: { id: goalId, userId },
        select: { id: true },
      });
      if (!goal) {
        return res.status(403).json({ error: "Invalid goalId for this user" });
      }
    }

    const task = await prisma.task.create({
      data: {
        userId,
        goalId: goalId || null,
        title,
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
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.dueDate.lte = end;
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

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });

    if (!task) return res.status(404).json({ error: "Task not found" });

    await prisma.task.delete({ where: { id: taskId } });

    return res.json({ ok: true, deletedTaskId: taskId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /tasks/:id — update task (title, dueDate, estimatedMin, goalId, status)
router.patch("/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { title, dueDate, estimatedMin, goalId, status, priority } = req.body;

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });

    if (!task) return res.status(404).json({ error: "Task not found" });

    const data = {};
    if (title !== undefined) data.title = String(title);
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (estimatedMin !== undefined) data.estimatedMin = estimatedMin != null ? Number(estimatedMin) : null;
    if (goalId !== undefined) data.goalId = goalId || null;
    if (priority !== undefined) {
      const allowedPriorities = new Set(["low", "medium", "high", "urgent"]);
      if (!allowedPriorities.has(priority)) {
        return res.status(400).json({ error: "priority must be low, medium, high, or urgent" });
      }
      data.priority = priority;
    }
    if (status !== undefined) {
      const allowed = new Set(["todo", "doing", "done"]);
      if (!allowed.has(status)) {
        return res.status(400).json({ error: "status must be todo, doing, or done" });
      }
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
router.patch("/:id/status", async (req, res) => {
  try {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { status } = req.body;

    const allowed = new Set(["todo", "doing", "done"]);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: "status must be todo, doing, or done" });
    }

    const task = await prisma.task.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });

    if (!task) return res.status(404).json({ error: "Task not found" });

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
