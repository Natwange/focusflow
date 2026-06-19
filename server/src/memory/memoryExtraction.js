const { validateMemoryContent } = require("./memoryContentSafety");

function isGenericTaskRequest(text) {
  const lower = String(text).toLowerCase().trim();
  return (
    /^(create|add|schedule|list|show|delete|complete|mark)\b/.test(lower) ||
    /\bcreate a task\b/.test(lower) ||
    /\badd a task\b/.test(lower)
  );
}

function isTransientState(text) {
  return /\b(?:tired|exhausted|sick|busy|stressed)\s+today\b/i.test(text);
}

function isExplicitRememberCommand(text) {
  return /\bremember\s+that\b/i.test(text) || /\bplease\s+remember\b/i.test(text);
}

function isForgetCommand(text) {
  return /\bforget\s+that\b/i.test(text) || /\bdo not remember\b/i.test(text);
}

/**
 * Rule-based preference extraction from a single user message.
 * @returns {string[]}
 */
function extractPreferenceMemoriesFromText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || isGenericTaskRequest(trimmed) || isTransientState(trimmed)) {
    return [];
  }

  const memories = [];

  const rememberMatch = trimmed.match(
    /\bremember\s+that\s+(.+?)(?:[.!?]|$)/i
  );
  if (rememberMatch?.[1]) {
    const candidate = `User preference: ${rememberMatch[1].trim()}`;
    if (validateMemoryContent(candidate).ok) memories.push(candidate);
    return memories;
  }

  const patterns = [
    {
      re: /\bI\s+(?:focus|study|work)\s+better\s+(?:in|during)\s+(?:the\s+)?(morning|afternoon|evening|night|weekends?|weekdays?)\b/i,
      fmt: (m) => `User studies best in the ${m[1].toLowerCase()}.`,
    },
    {
      re: /\bI\s+(?:hate|dislike|avoid)\s+(?:studying\s+on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mondays?|weekends?|weekdays?)\b/i,
      fmt: (m) => `User avoids ${m[1].toLowerCase()}.`,
    },
    {
      re: /\bI\s+(?:like|prefer|love)\s+(\d{1,3})[\s-]*minute\s+focus(?:\s+sessions?)?\b/i,
      fmt: (m) => `User prefers ${m[1]}-minute focus sessions.`,
    },
    {
      re: /\bI\s+prefer\s+(pomodoro|short|long)\s+(?:focus\s+)?sessions?\b/i,
      fmt: (m) => `User prefers ${m[1].toLowerCase()} focus sessions.`,
    },
    {
      re: /\bI\s+(?:like|prefer)\s+(?:max(?:imum)?\s+)?(\d{1,2})\s+tasks?\s+per\s+day\b/i,
      fmt: (m) => `User prefers at most ${m[1]} tasks per day.`,
    },
    {
      re: /\bI\s+struggle\s+with\s+(.+?)(?:[.!?]|$)/i,
      fmt: (m) => `User struggles with ${m[1].trim()}.`,
    },
    {
      re: /\bI(?:'m| am)\s+preparing\s+for\s+(.+?)(?:[.!?]|$)/i,
      fmt: (m) => `User is preparing for ${m[1].trim()}.`,
    },
    {
      re: /\bI\s+focus\s+better\s+(?:in|during)\s+(?:the\s+)?(morning|afternoon|evening)\b/i,
      fmt: (m) => `User focuses better in the ${m[1].toLowerCase()}.`,
    },
  ];

  for (const { re, fmt } of patterns) {
    const m = trimmed.match(re);
    if (!m) continue;
    const candidate = fmt(m);
    if (validateMemoryContent(candidate).ok) {
      memories.push(candidate);
      break;
    }
  }

  return memories;
}

function shouldAttemptMem0Inference(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || isGenericTaskRequest(trimmed) || isTransientState(trimmed)) {
    return false;
  }
  if (isExplicitRememberCommand(trimmed)) return true;
  return /\b(?:prefer|like|love|hate|dislike|avoid|struggle|better in|best in|focus session)\b/i.test(
    trimmed
  );
}

module.exports = {
  extractPreferenceMemoriesFromText,
  isExplicitRememberCommand,
  isForgetCommand,
  isGenericTaskRequest,
  isTransientState,
  shouldAttemptMem0Inference,
};
