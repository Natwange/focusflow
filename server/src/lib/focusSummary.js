const prisma = require("./prisma");

function parseTzOffsetMinutes(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < -840 || n > 840) return 0;
  return n;
}

function localKeyFromUtcDate(utcDate, tzOffsetMinutes) {
  const localMs = utcDate.getTime() - tzOffsetMinutes * 60 * 1000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function utcRangeForLocalDateKey(localDateKey, tzOffsetMinutes) {
  const [yStr, mStr, dStr] = String(localDateKey).split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) + tzOffsetMinutes * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return { startUtc: new Date(startUtcMs), endUtc: new Date(endUtcMs) };
}

/**
 * Same payload as GET /focus/summary.
 */
async function getFocusSummaryForUser(userId, { tzOffsetMinutes = 0, dateKey = null } = {}) {
  const tz = parseTzOffsetMinutes(tzOffsetMinutes);
  const todayKey = dateKey ?? localKeyFromUtcDate(new Date(), tz);

  const range = utcRangeForLocalDateKey(todayKey, tz);
  if (!range) {
    const err = new Error("Invalid date");
    err.code = "INVALID_DATE";
    throw err;
  }

  const sessionsToday = await prisma.focusSession.findMany({
    where: {
      userId,
      startedAt: { gte: range.startUtc, lt: range.endUtc },
    },
    select: { duration: true, startedAt: true },
  });
  const todayMinutes = sessionsToday.reduce(
    (sum, s) => sum + (Number(s.duration) || 0),
    0
  );

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { streakCount: true, streakDateKey: true },
  });
  const streak = typeof user?.streakCount === "number" ? user.streakCount : 0;

  return { todayKey, todayMinutes, streak };
}

module.exports = {
  getFocusSummaryForUser,
  parseTzOffsetMinutes,
  localKeyFromUtcDate,
  utcRangeForLocalDateKey,
};
