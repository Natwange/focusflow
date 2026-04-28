const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

function parseTzOffsetMinutes(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < -840 || n > 840) return 0;
  return n;
}

function localDateKeyFromUtcInstant(utcDate, tzOffsetMinutes) {
  const localMs = utcDate.getTime() - tzOffsetMinutes * 60 * 1000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function prevDateKey(dateKey) {
  const [yStr, mStr, dStr] = String(dateKey).split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const ms = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 24 * 60 * 60 * 1000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// POST /activity/ping
// Counts as "you visited the app today".
// Rules (Duolingo-like):
// - first visit ever => streak = 1
// - visiting again same day => streak unchanged
// - visiting on next day (yesterday was last visit day) => streak +1
// - if you missed at least one full day => streak reset to 1
router.post("/ping", async (req, res) => {
  try {
    const userId = req.user.id;
    const tzOffsetMinutes = parseTzOffsetMinutes(
      req.body?.tzOffsetMinutes ?? req.query?.tzOffsetMinutes
    );
    const todayKey = localDateKeyFromUtcInstant(new Date(), tzOffsetMinutes);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { streakCount: true, streakDateKey: true },
    });

    const lastKey = user?.streakDateKey ?? null;
    const lastCount = typeof user?.streakCount === "number" ? user.streakCount : 0;

    let nextCount = lastCount;
    let nextKey = lastKey;

    if (!lastKey) {
      nextCount = 1;
      nextKey = todayKey;
    } else if (lastKey === todayKey) {
      // already counted today
      nextCount = Math.max(1, lastCount);
      nextKey = lastKey;
    } else {
      const yesterdayKey = prevDateKey(todayKey);
      if (yesterdayKey && lastKey === yesterdayKey) {
        nextCount = Math.max(1, lastCount) + 1;
      } else {
        nextCount = 1; // missed a day -> restart
      }
      nextKey = todayKey;
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        streakCount: nextCount,
        streakDateKey: nextKey,
        lastActiveAt: new Date(),
      },
    });

    return res.json({ todayKey, streak: nextCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;

