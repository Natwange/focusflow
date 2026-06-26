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
  return isExplicitRememberRequest(text);
}

function isMemoryRecallRequest(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;

  return (
    /\bwhat\s+(?:do\s+)?(?:you\s+)?know\s+about\s+me\b/i.test(trimmed) ||
    /\bwhat\s+(?:do\s+)?(?:you\s+)?remember\s+about\s+me\b/i.test(trimmed) ||
    /\b(?:do|can)\s+you\s+remember\s+(?:anything\s+)?about\s+me\b/i.test(trimmed) ||
    /\blist\s+(?:what\s+)?(?:you\s+)?remember(?:\s+about\s+me)?\b/i.test(trimmed) ||
    /\bshow\s+(?:me\s+)?(?:what\s+)?(?:you\s+)?remember(?:\s+about\s+me)?\b/i.test(trimmed) ||
    /\btell\s+me\s+what\s+you\s+(?:know|remember)\s+about\s+me\b/i.test(trimmed) ||
    /\bwhat\s+(?:are\s+)?my\s+(?:stored\s+)?preferences\b/i.test(trimmed)
  );
}

function isJunkRememberContent(body) {
  const normalized = String(body ?? "")
    .trim()
    .toLowerCase()
    .replace(/^user\s+preference:\s*/i, "");

  if (normalized.length < 4) return true;

  const junkPhrases = new Set([
    "what",
    "me",
    "about me",
    "my preferences",
    "my preference",
    "anything about me",
  ]);
  if (junkPhrases.has(normalized)) return true;
  if (/^(what|who|how|when|where|why)\b/.test(normalized)) return true;
  if (/^about\s+me$/.test(normalized)) return true;

  return false;
}

function isExplicitRememberRequest(text) {
  if (isForgetCommand(text)) return false;
  if (isMemoryRecallRequest(text)) return false;
  return (
    /\bremember\s+(?:that\s+)?/i.test(text) ||
    /\bkeep\s+in\s+mind\b/i.test(text) ||
    /\bsave\s+this\s+preference\b/i.test(text)
  );
}

function extractExplicitRememberContent(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  const patterns = [
    /\bremember\s+that\s+(.+?)(?:[.!?]|$)/i,
    /\bplease\s+remember\s+(?:that\s+)?(.+?)(?:[.!?]|$)/i,
    /\bremember\s+(.+?)(?:[.!?]|$)/i,
    /\bkeep\s+in\s+mind\s+that\s+(.+?)(?:[.!?]|$)/i,
    /\bkeep\s+in\s+mind\s+(.+?)(?:[.!?]|$)/i,
  ];

  for (const re of patterns) {
    const m = trimmed.match(re);
    if (!m?.[1]) continue;
    const body = m[1].trim().replace(/^that\s+/i, "");
    if (body.length < 3 || isJunkRememberContent(body)) continue;
    const candidate = /^user\s+preference:/i.test(body)
      ? body
      : `User preference: ${body}`;
    if (validateMemoryContent(candidate).ok) return candidate;
  }

  return null;
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

  const explicit = extractExplicitRememberContent(trimmed);
  if (explicit) {
    memories.push(explicit);
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
  if (
    !trimmed ||
    isGenericTaskRequest(trimmed) ||
    isTransientState(trimmed) ||
    isMemoryRecallRequest(trimmed)
  ) {
    return false;
  }
  if (isExplicitRememberCommand(trimmed)) return true;
  return /\b(?:prefer|like|love|hate|dislike|avoid|struggle|better in|best in|focus session)\b/i.test(
    trimmed
  );
}

module.exports = {
  extractPreferenceMemoriesFromText,
  extractExplicitRememberContent,
  isExplicitRememberCommand,
  isExplicitRememberRequest,
  isMemoryRecallRequest,
  isJunkRememberContent,
  isForgetCommand,
  isGenericTaskRequest,
  isTransientState,
  shouldAttemptMem0Inference,
};
