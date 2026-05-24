const { z } = require("zod");

const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const taskStatusSchema = z.enum(["todo", "doing", "done"]);
const weekdaySchema = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
const focusModeSchema = z.enum(["focus", "short", "long"]);

const isoLikeString = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

const goalIdField = z.string().trim().min(1).max(64);

const toolArgSchemas = {
  list_tasks: z.object({
    status: taskStatusSchema.optional(),
    goalId: goalIdField.optional(),
    startDate: isoLikeString.optional(),
    endDate: isoLikeString.optional(),
    includeOverdue: z.boolean().optional(),
    excludeDone: z.boolean().optional(),
  }),

  create_task: z.object({
    title: z.string().trim().min(1, "title is required").max(500),
    goalId: z.union([goalIdField, z.null()]).optional(),
    estimatedMin: z.coerce.number().int().nonnegative().nullable().optional(),
    dueDate: z.union([isoLikeString, z.null()]).optional(),
    priority: taskPrioritySchema.optional(),
  }),

  get_focus_summary: z.object({
    tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
  }),

  suggest_focus_session: z.object({
    mode: focusModeSchema.optional(),
    durationMinutes: z.coerce.number().int().positive().max(240).optional(),
    label: z.string().trim().max(200).optional(),
  }),

  preview_goal_plan: z.object({
    goalId: goalIdField,
    startDate: isoLikeString.optional(),
    availableDays: z.array(weekdaySchema).max(7).optional(),
    maxUnitsPerDay: z
      .union([
        z.null(),
        z.coerce.number().int().positive().max(10_000),
      ])
      .optional(),
  }),
};

/** V1 tool names exposed to the future LLM layer. */
const V1_TOOL_NAMES = Object.freeze([
  "list_tasks",
  "create_task",
  "get_focus_summary",
  "suggest_focus_session",
  "preview_goal_plan",
]);

const TOOL_CATALOG = {
  list_tasks: {
    description: "List the user's tasks with optional date range and filters.",
    readOnly: true,
  },
  create_task: {
    description: "Create a single task for the user.",
    readOnly: false,
  },
  get_focus_summary: {
    description: "Today's logged focus minutes and visit streak (timezone-aware).",
    readOnly: true,
  },
  suggest_focus_session: {
    description:
      "Suggest starting a focus timer in the client app (does not start a server session).",
    readOnly: true,
  },
  preview_goal_plan: {
    description:
      "Preview a goal study plan (read-only; does not create tasks or confirm a plan).",
    readOnly: true,
  },
};

/**
 * @param {string} toolName
 * @param {unknown} rawArgs
 * @returns {{ ok: true, args: object } | { ok: false, error: string }}
 */
function parseToolArgs(toolName, rawArgs) {
  const schema = toolArgSchemas[toolName];
  if (!schema) {
    return { ok: false, error: `Unknown tool: ${toolName}` };
  }

  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const detail = first?.message ?? "Invalid tool arguments";
    return { ok: false, error: `${toolName}: ${detail}` };
  }

  return { ok: true, args: parsed.data };
}

function getToolDefinitions() {
  return V1_TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_CATALOG[name].description,
    readOnly: TOOL_CATALOG[name].readOnly,
  }));
}

function isV1ToolName(name) {
  return V1_TOOL_NAMES.includes(name);
}

module.exports = {
  V1_TOOL_NAMES,
  TOOL_CATALOG,
  toolArgSchemas,
  parseToolArgs,
  getToolDefinitions,
  isV1ToolName,
};
