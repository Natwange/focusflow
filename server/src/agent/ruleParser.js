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

function parseCreateTaskDetails(message, tzOffsetMinutes) {
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

  if (isCreateTaskMessage(lower)) {
    const parsed = parseCreateTaskDetails(trimmed, tzOffsetMinutes);
    if (!parsed.ok) {
      const assistantMessage =
        parsed.reason === "missing_title"
          ? "What should the task be called?"
          : "To create a task I need a title and a due date/time, for example: tomorrow at 11am.";
      return {
        intent: INTENTS.CLARIFY,
        type: "clarify",
        assistantMessage,
      };
    }
    return {
      intent: INTENTS.CREATE_TASK,
      type: "execute",
      toolCalls: [
        {
          tool: "create_task",
          args: {
            title: parsed.title,
            dueDate: parsed.dueDate,
            priority: "medium",
          },
        },
      ],
    };
  }

  return {
    intent: INTENTS.UNSUPPORTED,
    type: "unsupported",
    assistantMessage:
      "I can help with today's tasks, creating a task (with a due date/time), starting focus, or previewing a plan when you include a goal id (e.g. preview plan for goal goal_1).",
  };
}

module.exports = {
  INTENTS,
  MESSAGE_MAX_LENGTH,
  parseRuleBasedMessage,
  todayTaskListArgs,
};
