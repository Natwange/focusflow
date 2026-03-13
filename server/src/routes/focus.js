const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

// POST /focus — save a completed focus session
router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { label, duration, startedAt, endedAt } = req.body;

    if (!duration || !startedAt || !endedAt) {
      return res.status(400).json({ error: "duration, startedAt, and endedAt are required" });
    }

    const session = await prisma.focusSession.create({
      data: {
        userId,
        label: label || null,
        duration: Number(duration),
        startedAt: new Date(startedAt),
        endedAt: new Date(endedAt),
      },
    });

    return res.status(201).json(session);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /focus/stats — total sessions + streak (consecutive days with at least one session)
router.get("/stats", async (req, res) => {
  try {
    const userId = req.user.id;

    const totalSessions = await prisma.focusSession.count({ where: { userId } });

    // Streak: count consecutive days (ending today) that have at least one session
    const sessions = await prisma.focusSession.findMany({
      where: { userId },
      select: { startedAt: true },
      orderBy: { startedAt: "desc" },
    });

    let streak = 0;
    if (sessions.length > 0) {
      const seen = new Set();
      for (const s of sessions) {
        const d = s.startedAt;
        seen.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      }

      const today = new Date();
      const check = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      while (true) {
        const key = `${check.getFullYear()}-${String(check.getMonth() + 1).padStart(2, "0")}-${String(check.getDate()).padStart(2, "0")}`;
        if (seen.has(key)) {
          streak++;
          check.setDate(check.getDate() - 1);
        } else {
          break;
        }
      }
    }

    return res.json({ totalSessions, streak });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /focus — list sessions (optional query: limit)
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const sessions = await prisma.focusSession.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    return res.json(sessions);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
