const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

// POST /tasks
router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, goalId, estimatedMin, dueDate } = req.body;

    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }

    // If goalId provided, ensure it belongs to this user
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
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, goalId } = req.query;

    const where = { userId };
    if (status) where.status = String(status);
    if (goalId) where.goalId = String(goalId);

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
