const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

function parseTzOffsetMinutes(v) {
  const n = Number(v);
  // JS Date.getTimezoneOffset() is usually within [-840, 840]
  if (!Number.isFinite(n) || n < -840 || n > 840) return 0;
  return n;
}

function localKeyFromUtcDate(utcDate, tzOffsetMinutes) {
  // Convert UTC instant -> user's local instant by subtracting offset minutes
  // local = UTC - offsetMinutes
  const localMs = utcDate.getTime() - tzOffsetMinutes * 60 * 1000;
  const d = new Date(localMs);
  // Use UTC getters because we already shifted into "local space"
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function utcRangeForLocalDateKey(localDateKey, tzOffsetMinutes) {
  // local date key is YYYY-MM-DD in user's local timezone.
  const [yStr, mStr, dStr] = String(localDateKey).split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  // Local midnight corresponds to UTC midnight + offsetMinutes.
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMinutes * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return { startUtc: new Date(startUtcMs), endUtc: new Date(endUtcMs) };
}

function dayNumberSince(startKey, endKey) {
  // Both keys are YYYY-MM-DD (local keys).
  const parse = (k) => {
    const [y, m, d] = String(k).split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    return Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  };
  const s = parse(startKey);
  const e = parse(endKey);
  if (s == null || e == null) return null;
  const diffDays = Math.floor((e - s) / (24 * 60 * 60 * 1000));
  return diffDays + 1; // inclusive: same day => Day 1
}

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

// GET /focus/summary — streak + today's focus minutes (timezone aware)
// Query: tzOffsetMinutes (from client Date.getTimezoneOffset()), date (optional YYYY-MM-DD)
router.get("/summary", async (req, res) => {
  try {
    const userId = req.user.id;
    const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);

    // Determine "today" in user's local timezone
    const requestedDateKey = req.query.date ? String(req.query.date) : null;
    const todayKey =
      requestedDateKey ??
      localKeyFromUtcDate(new Date(), tzOffsetMinutes);

    // Today's focus minutes
    const range = utcRangeForLocalDateKey(todayKey, tzOffsetMinutes);
    if (!range) return res.status(400).json({ error: "Invalid date" });

    const sessionsToday = await prisma.focusSession.findMany({
      where: {
        userId,
        startedAt: { gte: range.startUtc, lt: range.endUtc },
      },
      select: { duration: true, startedAt: true },
    });
    const todayMinutes = sessionsToday.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);

    // Duolingo-style streak: based on visits tracked by /activity/ping
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { streakCount: true, streakDateKey: true },
    });
    const streak = typeof user?.streakCount === "number" ? user.streakCount : 0;

    return res.json({ todayKey, todayMinutes, streak });
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { streakCount: true },
    });
    const streak = typeof user?.streakCount === "number" ? user.streakCount : 0;

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
