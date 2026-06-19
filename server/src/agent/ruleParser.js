const {
  parseTzOffsetMinutes,
  localKeyFromUtcDate,
  utcRangeForLocalDateKey,
} = require("../lib/focusSummary");

const MESSAGE_MAX_LENGTH = 2000;

const INTENTS = Object.freeze({
  LIST_TODAY_TASKS: "list_today_tasks",
  CREATE_TASK: "create_task",
  START_FOCUS: "start_focus",
  PREVIEW_GOAL_PLAN: "preview_goal_plan",
  CLARIFY: "clarify",
  UNSUPPORTED: "unsupported",
});

function normalizeMessage(message) {
  return String(message).trim().replace(/\s+/g, " ");
}

function isListTodayTasksMessage(lower) {
  if (/\bshow my tasks\b/.test(lower)) return true;
  return (
    /\b(show|list|what are|what's)\b.*\b(today'?s?|my)\b.*\btasks?\b/.test(lower) ||
    /\btasks?\b.*\btoday\b/.test(lower) ||
    /\bwhat are my tasks today\b/.test(lower)
  );
}

function isIncompleteTasksIntent(lower) {
  return (
    /\bincomplete\b.*\btasks?\b/.test(lower) ||
    /\btasks?\b.*\bincomplete\b/.test(lower) ||
    /\bremaining\b.*\btasks?\b/.test(lower) ||
    /\bwhat\b.*\bleft\b.*\btoday\b/.test(lower)
  );
}

/**
 * When the user asks for today's / incomplete remaining work, apply the same
 * filters as the rule-based parser (exclude done, include overdue).
 */
function listTasksArgsForTodayIntent(message, tzOffsetMinutes, partialArgs = {}) {
  const lower = String(message).toLowerCase();
  if (!isListTodayTasksMessage(lower) && !isIncompleteTasksIntent(lower)) {
    return partialArgs;
  }
  const defaults = todayTaskListArgs(tzOffsetMinutes);
  return {
    ...partialArgs,
    startDate: defaults.startDate,
    endDate: defaults.endDate,
    includeOverdue: true,
    excludeDone: true,
  };
}

function isCreateTaskMessage(lower) {
  return /\b(create|add)\s+(a\s+)?task\b/.test(lower);
}

function isStartFocusMessage(lower) {
  return /\bstart\b.*\bfocus\b/.test(lower) || /\bstart focus\b/.test(lower);
}

function extractGoalIdForPreview(message) {
  const m = message.match(
    /\bpreview\s+plan\s+for\s+goal\s+([A-Za-z0-9_-]+)\b/i
  );
  return m ? m[1] : null;
}

const MONTH_NAME_TO_INDEX = Object.freeze({
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
});

function cleanTaskTitle(raw) {
  return String(raw)
    .trim()
    .replace(/^to\s+/i, "")
    .replace(/^['"](.+)['"]$/, "$1")
    .trim();
}

function parseClockHour(hourStr, minuteStr, ampm) {
  let hour = Number(hourStr);
  const minute = minuteStr != null && minuteStr !== "" ? Number(minuteStr) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;

  const mer = ampm ? String(ampm).toLowerCase() : null;
  if (mer === "am" || mer === "pm") {
    if (hour < 1 || hour > 12) return null;
    if (mer === "am") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute };
}

/**
 * Local calendar day + clock → UTC ISO string (matches focusSummary offset convention).
 */
function localDateTimeToUtcIso({ dayOffset, hour, minute, tzOffsetMinutes, now = new Date() }) {
  const tz = parseTzOffsetMinutes(tzOffsetMinutes);
  const todayKey = localKeyFromUtcDate(now, tz);
  const [yStr, mStr, dStr] = todayKey.split("-");
  const baseUtc = Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr), 0, 0, 0, 0);
  const localMidnightUtc = baseUtc + tz * 60 * 1000;
  const targetLocalMs =
    localMidnightUtc + dayOffset * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000 + minute * 60 * 1000;
  const utcMs = targetLocalMs + tz * 60 * 1000;
  return new Date(utcMs).toISOString();
}

function localCalendarDateToUtcIso({ year, month, day, hour, minute, tzOffsetMinutes }) {
  const tz = parseTzOffsetMinutes(tzOffsetMinutes);
  const baseUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const localMidnightUtc = baseUtc + tz * 60 * 1000;
  const targetLocalMs =
    localMidnightUtc + hour * 60 * 60 * 1000 + minute * 60 * 1000;
  const utcMs = targetLocalMs + tz * 60 * 1000;
  return new Date(utcMs).toISOString();
}

function parseNamedCalendarDateInText(text, now = new Date()) {
  const m = String(text).match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (!m) return null;

  const month = MONTH_NAME_TO_INDEX[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = m[3] ? Number(m[3]) : now.getFullYear();
  if (!month || !Number.isFinite(day) || day < 1 || day > 31) return null;

  return { year, month, day };
}

function isCreateTaskRetryMessage(message) {
  const lower = String(message).toLowerCase().trim();
  if (isCreateTaskMessage(lower)) return false;
  return (
    /\b(haven'?t|didn'?t|not)\s+(added|created|create)\b/.test(lower) ||
    /\bplease\s+add\b/.test(lower) ||
    /\b(add|create)\s+it\b/.test(lower) ||
    /\byou\s+didn'?t\s+add\b/.test(lower) ||
    /\bstill\s+not\s+(there|added|showing)\b/.test(lower)
  );
}

function createTaskArgsFromParsed(parsed) {
  const args = {
    title: cleanTaskTitle(parsed.title),
    dueDate: parsed.dueDate,
    priority: "medium",
  };
  if (parsed.startTime && parsed.endTime) {
    args.startTime = parsed.startTime;
    args.endTime = parsed.endTime;
  }
  return args;
}

function findLastUserCreateTaskArgs(history, tzOffsetMinutes) {
  if (!Array.isArray(history)) return null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry?.role !== "user" || !entry.text) continue;

    const text = entry.text.trim();
    if (isCreateTaskRetryMessage(text)) continue;

    const scheduled = parseScheduledTaskRange(text, tzOffsetMinutes);
    if (scheduled.ok) return createTaskArgsFromParsed(scheduled);

    const single = parseCreateTaskDetails(text, tzOffsetMinutes);
    if (single.ok) return createTaskArgsFromParsed(single);
  }

  return null;
}

function parseCreateTaskDetails(message, tzOffsetMinutes) {
  const scheduled = parseScheduledTaskRange(message, tzOffsetMinutes);
  if (scheduled.ok) {
    return scheduled;
  }

  const m = message.match(
    /(?:create|add)\s+(?:a\s+)?task\s+(?:to\s+)?(.+?)\s+(today|tomorrow)(?:\s+at\s+|\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (!m) {
    return { ok: false, reason: "missing_fields" };
  }

  const title = m[1].trim().replace(/^to\s+/i, "");
  if (!title) {
    return { ok: false, reason: "missing_title" };
  }

  const dayWord = m[2].toLowerCase();
  const dayOffset = dayWord === "tomorrow" ? 1 : 0;
  const clock = parseClockHour(m[3], m[4], m[5]);
  if (!clock) {
    return { ok: false, reason: "missing_time" };
  }

  const dueDate = localDateTimeToUtcIso({
    dayOffset,
    hour: clock.hour,
    minute: clock.minute,
    tzOffsetMinutes,
  });

  return { ok: true, title, dueDate };
}

/**
 * "Add LeetCode from 2 PM to 3 PM tomorrow" → startTime, endTime, dueDate.
 */
function buildScheduledRangeResult({
  title,
  startClock,
  endClock,
  tzOffsetMinutes,
  dayOffset = 0,
  calendarDate = null,
}) {
  if (!title) {
    return { ok: false, reason: "missing_title" };
  }
  if (!startClock || !endClock) {
    return { ok: false, reason: "missing_time" };
  }

  const startTime = calendarDate
    ? localCalendarDateToUtcIso({
        ...calendarDate,
        hour: startClock.hour,
        minute: startClock.minute,
        tzOffsetMinutes,
      })
    : localDateTimeToUtcIso({
        dayOffset,
        hour: startClock.hour,
        minute: startClock.minute,
        tzOffsetMinutes,
      });
  const endTime = calendarDate
    ? localCalendarDateToUtcIso({
        ...calendarDate,
        hour: endClock.hour,
        minute: endClock.minute,
        tzOffsetMinutes,
      })
    : localDateTimeToUtcIso({
        dayOffset,
        hour: endClock.hour,
        minute: endClock.minute,
        tzOffsetMinutes,
      });

  if (Date.parse(endTime) <= Date.parse(startTime)) {
    return { ok: false, reason: "invalid_range" };
  }

  return {
    ok: true,
    title,
    dueDate: startTime,
    startTime,
    endTime,
  };
}

function parseScheduledTaskRange(message, tzOffsetMinutes) {
  const calendarDate = parseNamedCalendarDateInText(message);
  const calendarRangeMatch = message.match(
    /(?:create|add|schedule)\s+(?:a\s+)?(?:task\s+)?(.+?)\s+from\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
  );
  if (calendarRangeMatch && calendarDate) {
    const title = cleanTaskTitle(calendarRangeMatch[1]);
    const startClock = parseClockHour(
      calendarRangeMatch[2],
      calendarRangeMatch[3],
      calendarRangeMatch[4]
    );
    const endClock = parseClockHour(
      calendarRangeMatch[5],
      calendarRangeMatch[6],
      calendarRangeMatch[7]
    );
    const result = buildScheduledRangeResult({
      title,
      startClock,
      endClock,
      tzOffsetMinutes,
      calendarDate,
    });
    if (result.ok) return result;
  }

  const patterns = [
    /(?:create|add|schedule)\s+(?:a\s+)?(?:task\s+)?(.+?)\s+from\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(today|tomorrow))?/i,
    /(?:create|add|schedule)\s+(?:a\s+)?(?:task\s+)?(.+?)\s+(today|tomorrow)\s+from\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  ];

  for (const pattern of patterns) {
    const m = message.match(pattern);
    if (!m) continue;

    const title = cleanTaskTitle(m[1]);
    let dayOffset = 0;
    let startIdx = 2;
    if (/^(today|tomorrow)$/i.test(m[2])) {
      dayOffset = m[2].toLowerCase() === "tomorrow" ? 1 : 0;
      startIdx = 3;
    } else if (m[8]) {
      dayOffset = m[8].toLowerCase() === "tomorrow" ? 1 : 0;
    }

    const startClock = parseClockHour(m[startIdx], m[startIdx + 1], m[startIdx + 2]);
    const endClock = parseClockHour(
      m[startIdx + 3],
      m[startIdx + 4],
      m[startIdx + 5]
    );

    const result = buildScheduledRangeResult({
      title,
      startClock,
      endClock,
      tzOffsetMinutes,
      dayOffset,
    });
    if (result.ok) return result;
  }

  return { ok: false, reason: "no_range" };
}

function parseRescheduleTaskDetails(message, tzOffsetMinutes) {
  const m = message.match(
    /move\s+(?:my\s+)?(.+?)\s+(?:task\s+)?to\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(today|tomorrow))?/i
  );
  if (!m) return { ok: false, reason: "no_match" };

  const taskTitle = m[1].trim();
  if (!taskTitle) return { ok: false, reason: "missing_title" };

  const dayOffset = m[5] && m[5].toLowerCase() === "tomorrow" ? 1 : 0;
  const clock = parseClockHour(m[2], m[3], m[4]);
  if (!clock) return { ok: false, reason: "missing_time" };

  const startTime = localDateTimeToUtcIso({
    dayOffset,
    hour: clock.hour,
    minute: clock.minute,
    tzOffsetMinutes,
  });

  return {
    ok: false,
    reason: "missing_end_time",
    taskTitle,
    startTime,
    clarifyMessage: `What time should "${taskTitle}" end? I need both a start and end time to schedule it.`,
  };
}

function parseFocusDurationMinutes(message) {
  const m = message.match(/\b(\d{1,3})\s*(?:minute|minutes|min)\b/i);
  if (!m) return 25;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 240) return 25;
  return n;
}

function todayTaskListArgs(tzOffsetMinutes, now = new Date()) {
  const tz = parseTzOffsetMinutes(tzOffsetMinutes);
  const todayKey = localKeyFromUtcDate(now, tz);
  const range = utcRangeForLocalDateKey(todayKey, tz);
  if (!range) {
    throw new Error("Invalid local date range");
  }
  return {
    startDate: range.startUtc.toISOString(),
    endDate: new Date(range.endUtc.getTime() - 1).toISOString(),
    includeOverdue: true,
    excludeDone: true,
  };
}

/**
 * Rule-based NL → tool plan (no LLM).
 *
 * @returns {{
 *   intent: string,
 *   type: "execute" | "clarify" | "unsupported",
 *   toolCalls?: Array<{ tool: string, args: object }>,
 *   assistantMessage?: string,
 * }}
 */
function parseRuleBasedMessage(message, tzOffsetMinutes = 0) {
  const trimmed = normalizeMessage(message);
  if (!trimmed) {
    return {
      intent: INTENTS.CLARIFY,
      type: "clarify",
      assistantMessage: "Please send a message describing what you want to do.",
    };
  }
  if (trimmed.length > MESSAGE_MAX_LENGTH) {
    return {
      intent: INTENTS.CLARIFY,
      type: "clarify",
      assistantMessage: `Message is too long (max ${MESSAGE_MAX_LENGTH} characters).`,
    };
  }

  const lower = trimmed.toLowerCase();

  if (isListTodayTasksMessage(lower)) {
    return {
      intent: INTENTS.LIST_TODAY_TASKS,
      type: "execute",
      toolCalls: [
        {
          tool: "list_tasks",
          args: todayTaskListArgs(tzOffsetMinutes),
        },
      ],
    };
  }

  if (isStartFocusMessage(lower)) {
    const durationMinutes = parseFocusDurationMinutes(trimmed);
    return {
      intent: INTENTS.START_FOCUS,
      type: "execute",
      toolCalls: [
        {
          tool: "suggest_focus_session",
          args: { mode: "focus", durationMinutes },
        },
      ],
    };
  }

  const goalId = extractGoalIdForPreview(trimmed);
  if (goalId) {
    return {
      intent: INTENTS.PREVIEW_GOAL_PLAN,
      type: "execute",
      toolCalls: [
        {
          tool: "preview_goal_plan",
          args: { goalId },
        },
      ],
    };
  }

  if (isCreateTaskMessage(lower) || /\bschedule\b/.test(lower)) {
    const parsed = parseCreateTaskDetails(trimmed, tzOffsetMinutes);
    if (!parsed.ok) {
      const assistantMessage =
        parsed.reason === "missing_title"
          ? "What should the task be called?"
          : parsed.reason === "invalid_range"
            ? "The end time must be after the start time. Try again with a valid range."
            : "To create a task I need a title and time, for example: from 2 PM to 3 PM tomorrow.";
      return {
        intent: INTENTS.CLARIFY,
        type: "clarify",
        assistantMessage,
      };
    }
    const args = {
      title: parsed.title,
      dueDate: parsed.dueDate,
      priority: "medium",
    };
    if (parsed.startTime && parsed.endTime) {
      args.startTime = parsed.startTime;
      args.endTime = parsed.endTime;
    }
    return {
      intent: INTENTS.CREATE_TASK,
      type: "execute",
      toolCalls: [
        {
          tool: "create_task",
          args,
        },
      ],
    };
  }

  const reschedule = parseRescheduleTaskDetails(trimmed, tzOffsetMinutes);
  if (reschedule.reason === "missing_end_time") {
    return {
      intent: INTENTS.CLARIFY,
      type: "clarify",
      assistantMessage: reschedule.clarifyMessage,
    };
  }

  return {
    intent: INTENTS.UNSUPPORTED,
    type: "unsupported",
    assistantMessage:
      "I can help with today's tasks, creating a task (with optional scheduled start/end times), starting focus, or previewing a plan when you include a goal id (e.g. preview plan for goal goal_1).",
  };
}

module.exports = {
  INTENTS,
  MESSAGE_MAX_LENGTH,
  parseRuleBasedMessage,
  parseCreateTaskDetails,
  parseScheduledTaskRange,
  parseRescheduleTaskDetails,
  todayTaskListArgs,
  isListTodayTasksMessage,
  isIncompleteTasksIntent,
  listTasksArgsForTodayIntent,
  isCreateTaskRetryMessage,
  findLastUserCreateTaskArgs,
  cleanTaskTitle,
};
