const { z } = require("zod");
const { refineTaskSchedule } = require("../lib/taskSchedule");

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
    goalTitle: z.string().trim().min(1).max(200).optional(),
    startDate: isoLikeString.optional(),
    endDate: isoLikeString.optional(),
    includeOverdue: z.boolean().optional(),
    excludeDone: z.boolean().optional(),
  }),

  create_task: z
    .object({
      title: z.string().trim().min(1, "title is required").max(500),
      goalId: z.union([goalIdField, z.null()]).optional(),
      estimatedMin: z.coerce.number().int().nonnegative().nullable().optional(),
      dueDate: z.union([isoLikeString, z.null()]).optional(),
      startTime: z.union([isoLikeString, z.null()]).optional(),
      endTime: z.union([isoLikeString, z.null()]).optional(),
      priority: taskPrioritySchema.optional(),
    })
    .superRefine(refineTaskSchedule),

  get_focus_summary: z.object({
    tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
  }),

  get_user_behavior_context: z.object({
    lookbackDays: z.coerce.number().int().min(7).max(366).optional(),
    tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
  }),

  suggest_focus_session: z.object({
    mode: focusModeSchema.optional(),
    durationMinutes: z.coerce.number().int().positive().max(240).optional(),
    label: z.string().trim().max(200).optional(),
  }),

  create_goal: z.object({
    title: z.string().trim().min(1, "title is required").max(200),
    totalUnits: z.coerce.number().int().positive().max(100_000),
    unitName: z.string().trim().min(1).max(80).optional(),
    deadline: z.string().trim().min(1).max(64),
    availableDays: z.array(weekdaySchema).max(7).optional(),
    maxUnitsPerDay: z
      .union([
        z.null(),
        z.coerce.number().int().positive().max(10_000),
      ])
      .optional(),
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

  confirm_goal_plan: z.object({
    goalId: goalIdField,
    confirmed: z.boolean().optional(),
  }),

  update_task: z
    .object({
      taskId: z.string().trim().min(1).max(64).optional(),
      taskTitle: z.string().trim().min(1).max(500).optional(),
      updates: z
        .object({
          title: z.string().trim().min(1).max(500).optional(),
          dueDate: z.union([isoLikeString, z.null()]).optional(),
          startTime: z.union([isoLikeString, z.null()]).optional(),
          endTime: z.union([isoLikeString, z.null()]).optional(),
          status: z.enum(["todo", "done"]).optional(),
        })
        .superRefine(refineTaskSchedule),
    })
    .refine(
      (d) => d.taskId || d.taskTitle,
      { message: "Provide taskId or taskTitle to identify the task." }
    ),

  complete_task: z.object({
    taskId: z.string().trim().min(1).max(64).optional(),
    taskTitle: z.string().trim().min(1).max(500).optional(),
  }).refine(
    (d) => d.taskId || d.taskTitle,
    { message: "Provide taskId or taskTitle to identify the task." }
  ),

  delete_task: z.object({
    taskId: z.string().trim().min(1).max(64).optional(),
    taskTitle: z.string().trim().min(1).max(500).optional(),
    confirmed: z.boolean().optional(),
  }).refine(
    (d) => d.taskId || d.taskTitle,
    { message: "Provide taskId or taskTitle to identify the task." }
  ),

  list_goals: z.object({
    status: z.enum(["active", "completed", "all"]).optional(),
  }),

  get_goal_agent_preview: z
    .object({
      goalId: goalIdField.optional(),
      goalTitle: z.string().trim().min(1).max(200).optional(),
    })
    .refine((d) => d.goalId || d.goalTitle, {
      message: "Provide goalId or goalTitle to identify the goal.",
    }),

  apply_goal_rebalance: z
    .object({
      goalId: goalIdField.optional(),
      goalTitle: z.string().trim().min(1).max(200).optional(),
      confirmed: z.boolean().optional(),
    })
    .refine((d) => d.goalId || d.goalTitle, {
      message: "Provide goalId or goalTitle to identify the goal.",
    }),

  preview_goal_adjustment: z
    .object({
      goalId: goalIdField.optional(),
      goalTitle: z.string().trim().min(1).max(200).optional(),
      deadline: z.string().trim().min(1).max(64).optional(),
      maxUnitsPerDay: z
        .union([z.null(), z.coerce.number().int().positive().max(10_000)])
        .optional(),
      spreadEvenly: z.boolean().optional(),
    })
    .refine((d) => d.goalId || d.goalTitle, {
      message: "Provide goalId or goalTitle to identify the goal.",
    }),

  apply_goal_adjustment: z
    .object({
      goalId: goalIdField.optional(),
      goalTitle: z.string().trim().min(1).max(200).optional(),
      deadline: z.string().trim().min(1).max(64).optional(),
      maxUnitsPerDay: z
        .union([z.null(), z.coerce.number().int().positive().max(10_000)])
        .optional(),
      spreadEvenly: z.boolean().optional(),
      confirmed: z.boolean().optional(),
    })
    .refine((d) => d.goalId || d.goalTitle, {
      message: "Provide goalId or goalTitle to identify the goal.",
    }),

  get_agent_suggestions: z.object({
    limit: z.coerce.number().int().min(1).max(10).optional(),
  }),

  evaluate_agent_outcomes: z.object({
    lookbackDays: z.coerce.number().int().min(7).max(366).optional(),
  }),

  get_agent_strategy_memory: z.object({
    lookbackDays: z.coerce.number().int().min(7).max(366).optional(),
  }),

  get_adaptive_recommendation: z.object({
    goalId: z.string().min(1).optional(),
    goalTitle: z.string().min(1).optional(),
    lookbackDays: z.coerce.number().int().min(7).max(366).optional(),
  }),

  retrieve_memory: z.object({
    query: z.string().trim().min(1).max(500),
    limit: z.coerce.number().int().min(1).max(20).optional(),
  }),

  store_memory: z.object({
    content: z.string().trim().min(1).max(500),
  }),

  list_memories: z.object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),

  delete_memory: z
    .object({
      memoryId: z.string().trim().min(1).max(128).optional(),
      query: z.string().trim().min(1).max(500).optional(),
    })
    .refine((d) => d.memoryId || d.query, {
      message: "Provide memoryId or query to identify the memory to delete.",
    }),

  calendar_create_event: z.object({
    summary: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    startTime: z.string().trim().min(1).max(64).optional(),
    endTime: z.string().trim().min(1).max(64).optional(),
    location: z.string().trim().max(300).optional(),
    timezone: z.string().trim().max(64).optional(),
    confirmed: z.boolean().optional(),
    events: z
      .array(
        z.object({
          summary: z.string().trim().min(1).max(200),
          description: z.string().trim().max(2000).optional(),
          startTime: z.string().trim().min(1).max(64),
          endTime: z.string().trim().min(1).max(64).optional(),
          location: z.string().trim().max(300).optional(),
          timezone: z.string().trim().max(64).optional(),
        })
      )
      .max(25)
      .optional(),
  }).refine(
    (d) =>
      (Array.isArray(d.events) && d.events.length > 0) ||
      (d.summary && d.startTime),
    { message: "Provide summary+startTime or a non-empty events array." }
  ),

  calendar_list_events: z.object({
    timeMin: z.string().trim().min(1).max(64).optional(),
    timeMax: z.string().trim().min(1).max(64).optional(),
    query: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),

  gmail_send_email: z.object({
    to: z.string().trim().email().max(320),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20000),
    cc: z.string().trim().max(500).optional(),
    bcc: z.string().trim().max(500).optional(),
    confirmed: z.boolean().optional(),
  }),

  gmail_create_draft: z.object({
    to: z.string().trim().email().max(320),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20000),
    cc: z.string().trim().max(500).optional(),
    bcc: z.string().trim().max(500).optional(),
  }),

  notion_create_page: z.object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(50000),
    parentPageId: z.string().trim().max(128).optional(),
    confirmed: z.boolean().optional(),
  }),

  notion_export_goal: z.object({
    goalId: z.string().trim().min(1).max(64).optional(),
    goalTitle: z.string().trim().min(1).max(200).optional(),
    pageTitle: z.string().trim().max(200).optional(),
    parentPageId: z.string().trim().max(128).optional(),
    confirmed: z.boolean().optional(),
  }).refine((d) => d.goalId || d.goalTitle, {
    message: "Provide goalId or goalTitle.",
  }),
};

/** V1 tool names exposed to the future LLM layer. */
const V1_TOOL_NAMES = Object.freeze([
  "list_tasks",
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "get_focus_summary",
  "get_user_behavior_context",
  "suggest_focus_session",
  "create_goal",
  "preview_goal_plan",
  "confirm_goal_plan",
  "list_goals",
  "get_goal_agent_preview",
  "apply_goal_rebalance",
  "preview_goal_adjustment",
  "apply_goal_adjustment",
  "get_agent_suggestions",
  "evaluate_agent_outcomes",
  "get_agent_strategy_memory",
  "get_adaptive_recommendation",
  "retrieve_memory",
  "store_memory",
  "list_memories",
  "delete_memory",
  "calendar_create_event",
  "calendar_list_events",
  "gmail_send_email",
  "gmail_create_draft",
  "notion_create_page",
  "notion_export_goal",
]);

const TOOL_CATALOG = {
  list_tasks: {
    description:
      "List the user's tasks with optional date range and filters. Identify a goal by goalId from list_goals or by goalTitle (user's words) — never invent or slugify goal ids.",
    readOnly: true,
  },
  create_task: {
    description:
      "Create a single task for the user. Optional startTime and endTime (ISO UTC) schedule a timed block; both must be provided together.",
    readOnly: false,
  },
  update_task: {
    description:
      "Update an existing task's title, due date, schedule (startTime/endTime), or status. Identify by taskId or taskTitle.",
    readOnly: false,
  },
  complete_task: {
    description: "Mark a task as done. Identify by taskId or taskTitle.",
    readOnly: false,
  },
  delete_task: {
    description: "Delete a task. Requires confirmation — set confirmed:true only after the user explicitly agrees.",
    readOnly: false,
  },
  get_focus_summary: {
    description: "Today's logged focus minutes and visit streak (timezone-aware).",
    readOnly: true,
  },
  get_user_behavior_context: {
    description:
      "Summarized productivity behavioral signals from recent tasks, focus sessions, goals, and agent runs. Use before planning goals or recommending workload distribution.",
    readOnly: true,
  },
  suggest_focus_session: {
    description:
      "Suggest starting a focus timer in the client app (does not start a server session).",
    readOnly: true,
  },
  create_goal: {
    description:
      "Create a new goal with title, total units, deadline, and optional schedule constraints.",
    readOnly: false,
  },
  preview_goal_plan: {
    description:
      "Preview a goal study plan (read-only; does not create tasks). Requires goalId.",
    readOnly: true,
  },
  confirm_goal_plan: {
    description:
      "Write scheduled tasks for a goal plan. NEVER set confirmed:true unless the user explicitly approved after seeing the preview.",
    readOnly: false,
  },
  list_goals: {
    description:
      "List the user's goals with summary fields (deadline, task counts, progress). Use before schedule fixes or rebalance.",
    readOnly: true,
  },
  get_goal_agent_preview: {
    description:
      "Run read-only goal evaluation and rebalance preview. Identify the goal by goalId from list_goals or by goalTitle. Does not change tasks.",
    readOnly: true,
  },
  apply_goal_rebalance: {
    description:
      "Apply due-date rebalance for a goal (goalId or goalTitle). NEVER set confirmed:true unless the user explicitly approved after seeing the preview.",
    readOnly: false,
  },
  preview_goal_adjustment: {
    description:
      "Preview a user-requested goal replan (new deadline, daily cap, or even spread). Works even when the goal is on track. Replans remaining units from today; completed tasks are kept.",
    readOnly: true,
  },
  apply_goal_adjustment: {
    description:
      "Apply a user-requested goal replan after preview. Updates deadline/cap if requested, deletes incomplete tasks, recreates schedule. NEVER set confirmed:true without explicit user approval.",
    readOnly: false,
  },
  get_agent_suggestions: {
    description:
      "Read-only proactive suggestions from the user's tasks, goals, focus history, and behavior signals. Use when the user asks what to work on, how they are doing, or if anything needs attention.",
    readOnly: true,
  },
  evaluate_agent_outcomes: {
    description:
      "Evaluate whether past accepted agent recommendations improved completion and missed-task metrics. Use when the user asks if suggestions or rebalances helped.",
    readOnly: false,
  },
  get_agent_strategy_memory: {
    description:
      "Read-only aggregate of past accepted strategy outcomes (rebalance, extend_deadline, reduce_scope, keep_plan). Use to inform recommendations — never claim learning without hasEnoughData.",
    readOnly: true,
  },
  get_adaptive_recommendation: {
    description:
      "Ranked recommendation for what to do next on a goal (or the most urgent goal) using current evaluation, outcome memory, and behavior signals. Use for 'what should I do?', 'how should I fix this?', or 'what do you recommend?'. Never auto-applies changes.",
    readOnly: true,
  },
  retrieve_memory: {
    description:
      "Search the user's long-term Mem0 preferences (study times, focus length, workload limits). Use when personalization would help and memories were not already injected.",
    readOnly: true,
  },
  store_memory: {
    description:
      "Save a stable user preference to long-term memory (e.g. morning study, 45-minute focus sessions). Never store passwords, tokens, or secrets.",
    readOnly: false,
  },
  list_memories: {
    description:
      "List stored long-term preferences for this user. Use when they ask what you remember about them.",
    readOnly: true,
  },
  delete_memory: {
    description:
      "Delete a stored preference by memoryId or by semantic query (e.g. 'weekends'). Use when the user asks to forget something.",
    readOnly: false,
  },
  calendar_create_event: {
    description:
      "Create Google Calendar event(s). Requires Google Calendar connected. NEVER set confirmed:true on first call — preview first, then execute after user approval. Use events[] for bulk scheduling.",
    readOnly: false,
  },
  calendar_list_events: {
    description:
      "List Google Calendar events in a time range. Read-only. Requires Google Calendar connected.",
    readOnly: true,
  },
  gmail_send_email: {
    description:
      "Send email via Gmail. NEVER set confirmed:true on first call — always preview and wait for explicit user approval before sending.",
    readOnly: false,
  },
  gmail_create_draft: {
    description:
      "Create a Gmail draft (does not send). Requires Gmail connected.",
    readOnly: false,
  },
  notion_create_page: {
    description:
      "Create a Notion page. NEVER set confirmed:true on first call — preview first, create after approval. Requires Notion connected.",
    readOnly: false,
  },
  notion_export_goal: {
    description:
      "Export a FocusFlow goal plan to a structured Notion page. NEVER set confirmed:true on first call — preview export, then create after approval.",
    readOnly: false,
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

/** OpenAI Chat Completions `tools` array (JSON Schema parameters aligned with Zod). */
const OPENAI_CHAT_TOOLS = Object.freeze([
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        `${TOOL_CATALOG.list_tasks.description} For today's remaining work, set excludeDone true, includeOverdue true, and pass startDate/endDate as ISO UTC for the user's local today.`,
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["todo", "doing", "done"] },
          goalTitle: { type: "string", description: "PREFERRED: words the user used to name the goal (e.g. human anatomy)" },
          goalId: { type: "string", description: "Only if copied verbatim from list_goals — never slugify" },
          startDate: { type: "string", description: "ISO 8601 UTC start" },
          endDate: { type: "string", description: "ISO 8601 UTC end" },
          includeOverdue: { type: "boolean" },
          excludeDone: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: TOOL_CATALOG.create_task.description,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          goalId: { type: ["string", "null"] },
          estimatedMin: { type: ["integer", "null"], minimum: 0 },
          dueDate: { type: ["string", "null"], description: "ISO 8601 UTC" },
          startTime: {
            type: ["string", "null"],
            description: "ISO 8601 UTC block start; requires endTime",
          },
          endTime: {
            type: ["string", "null"],
            description: "ISO 8601 UTC block end; requires startTime",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: TOOL_CATALOG.update_task.description,
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Exact task ID if known" },
          taskTitle: { type: "string", description: "Task title to search for" },
          updates: {
            type: "object",
            properties: {
              title: { type: "string", description: "New title" },
              dueDate: { type: ["string", "null"], description: "New due date ISO 8601 UTC, or null to clear" },
              startTime: {
                type: ["string", "null"],
                description: "Schedule block start ISO UTC; set with endTime",
              },
              endTime: {
                type: ["string", "null"],
                description: "Schedule block end ISO UTC; set with startTime",
              },
              status: { type: "string", enum: ["todo", "done"] },
            },
            additionalProperties: false,
          },
        },
        required: ["updates"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: TOOL_CATALOG.complete_task.description,
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Exact task ID if known" },
          taskTitle: { type: "string", description: "Task title to search for" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: TOOL_CATALOG.delete_task.description,
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Exact task ID if known" },
          taskTitle: { type: "string", description: "Task title to search for" },
          confirmed: { type: "boolean", description: "Must be true after user confirms deletion" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_focus_summary",
      description: TOOL_CATALOG.get_focus_summary.description,
      parameters: {
        type: "object",
        properties: {
          tzOffsetMinutes: { type: "integer" },
          date: { type: "string", description: "YYYY-MM-DD local day key" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_behavior_context",
      description: `${TOOL_CATALOG.get_user_behavior_context.description} Returns objective signals only — interpret them; do not invent statistics.`,
      parameters: {
        type: "object",
        properties: {
          lookbackDays: {
            type: "integer",
            minimum: 7,
            maximum: 366,
            description: "Days of history to analyze (default 30)",
          },
          tzOffsetMinutes: { type: "integer" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_focus_session",
      description: TOOL_CATALOG.suggest_focus_session.description,
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["focus", "short", "long"] },
          durationMinutes: { type: "integer", minimum: 1, maximum: 240 },
          label: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_goal",
      description: `${TOOL_CATALOG.create_goal.description} Deadline may be ISO UTC or phrases like "in 7 days", "in 2 weeks", "by June 1".`,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          totalUnits: { type: "integer", minimum: 1 },
          unitName: { type: "string", description: "e.g. lessons, chapters" },
          deadline: { type: "string", description: "ISO UTC or relative phrase" },
          availableDays: {
            type: "array",
            items: {
              type: "string",
              enum: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
            },
          },
          maxUnitsPerDay: { type: ["integer", "null"], minimum: 1 },
        },
        required: ["title", "totalUnits", "deadline"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preview_goal_plan",
      description: TOOL_CATALOG.preview_goal_plan.description,
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string" },
          startDate: { type: "string" },
          availableDays: {
            type: "array",
            items: {
              type: "string",
              enum: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
            },
          },
          maxUnitsPerDay: { type: ["integer", "null"], minimum: 1 },
        },
        required: ["goalId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_goal_plan",
      description: TOOL_CATALOG.confirm_goal_plan.description,
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string" },
          confirmed: {
            type: "boolean",
            description: "true only after user explicitly confirms plan creation",
          },
        },
        required: ["goalId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_goals",
      description: TOOL_CATALOG.list_goals.description,
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["active", "completed", "all"],
            description: "Filter goals (default active)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_goal_agent_preview",
      description: TOOL_CATALOG.get_goal_agent_preview.description,
      parameters: {
        type: "object",
        properties: {
          goalTitle: { type: "string", description: "PREFERRED: user's words for the goal (e.g. human anatomy)" },
          goalId: { type: "string", description: "Only if copied verbatim from list_goals" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_goal_rebalance",
      description: TOOL_CATALOG.apply_goal_rebalance.description,
      parameters: {
        type: "object",
        properties: {
          goalTitle: { type: "string", description: "PREFERRED: user's words for the goal" },
          goalId: { type: "string", description: "Only if copied verbatim from list_goals" },
          confirmed: {
            type: "boolean",
            description: "true only after user explicitly confirms rebalance",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preview_goal_adjustment",
      description: TOOL_CATALOG.preview_goal_adjustment.description,
      parameters: {
        type: "object",
        properties: {
          goalTitle: { type: "string", description: "PREFERRED: user's words for the goal" },
          goalId: { type: "string", description: "Only if copied verbatim from list_goals" },
          deadline: {
            type: "string",
            description:
              "New deadline in the user's words: 'July 10', 'July 10th', 'by July 10', 'in 30 days', or ISO '2026-07-10'",
          },
          maxUnitsPerDay: {
            type: ["integer", "null"],
            description: "New daily unit cap (omit if using spreadEvenly)",
          },
          spreadEvenly: {
            type: "boolean",
            description: "Spread remaining units evenly across eligible days (ignores daily cap)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_goal_adjustment",
      description: TOOL_CATALOG.apply_goal_adjustment.description,
      parameters: {
        type: "object",
        properties: {
          goalTitle: { type: "string", description: "PREFERRED: user's words for the goal" },
          goalId: { type: "string", description: "Only if copied verbatim from list_goals" },
          deadline: { type: "string" },
          maxUnitsPerDay: { type: ["integer", "null"] },
          spreadEvenly: { type: "boolean" },
          confirmed: {
            type: "boolean",
            description: "true only after user explicitly confirms the adjustment",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_agent_suggestions",
      description: TOOL_CATALOG.get_agent_suggestions.description,
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Max suggestions to return (default 3)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_agent_outcomes",
      description: TOOL_CATALOG.evaluate_agent_outcomes.description,
      parameters: {
        type: "object",
        properties: {
          lookbackDays: {
            type: "integer",
            minimum: 7,
            maximum: 366,
            description: "How far back to check accepted agent runs (default 30)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_agent_strategy_memory",
      description: TOOL_CATALOG.get_agent_strategy_memory.description,
      parameters: {
        type: "object",
        properties: {
          lookbackDays: {
            type: "integer",
            minimum: 7,
            maximum: 366,
            description: "Lookback window for strategy stats (default 90)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_adaptive_recommendation",
      description: TOOL_CATALOG.get_adaptive_recommendation.description,
      parameters: {
        type: "object",
        properties: {
          goalId: {
            type: "string",
            description: "Goal id from list_goals (optional if goalTitle provided)",
          },
          goalTitle: {
            type: "string",
            description:
              "User's words for the goal (e.g. 'javascript', 'human anatomy') — preferred over invented ids",
          },
          lookbackDays: {
            type: "integer",
            minimum: 7,
            maximum: 366,
            description: "Behavior lookback window (default 30)",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retrieve_memory",
      description: TOOL_CATALOG.retrieve_memory.description,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for in stored preferences" },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "store_memory",
      description: TOOL_CATALOG.store_memory.description,
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Stable preference to remember (no secrets)",
          },
        },
        required: ["content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_memories",
      description: TOOL_CATALOG.list_memories.description,
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_memory",
      description: TOOL_CATALOG.delete_memory.description,
      parameters: {
        type: "object",
        properties: {
          memoryId: { type: "string", description: "Exact memory id from list_memories" },
          query: {
            type: "string",
            description: "Semantic match when id is unknown (e.g. 'weekends')",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar_create_event",
      description: TOOL_CATALOG.calendar_create_event.description,
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string" },
          description: { type: "string" },
          startTime: { type: "string", description: "ISO UTC start" },
          endTime: { type: "string", description: "ISO UTC end" },
          location: { type: "string" },
          timezone: { type: "string" },
          confirmed: { type: "boolean" },
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                summary: { type: "string" },
                description: { type: "string" },
                startTime: { type: "string" },
                endTime: { type: "string" },
                location: { type: "string" },
                timezone: { type: "string" },
              },
              required: ["summary", "startTime"],
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar_list_events",
      description: TOOL_CATALOG.calendar_list_events.description,
      parameters: {
        type: "object",
        properties: {
          timeMin: { type: "string" },
          timeMax: { type: "string" },
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gmail_send_email",
      description: TOOL_CATALOG.gmail_send_email.description,
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          cc: { type: "string" },
          bcc: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gmail_create_draft",
      description: TOOL_CATALOG.gmail_create_draft.description,
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          cc: { type: "string" },
          bcc: { type: "string" },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notion_create_page",
      description: TOOL_CATALOG.notion_create_page.description,
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          parentPageId: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["title", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notion_export_goal",
      description: TOOL_CATALOG.notion_export_goal.description,
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string" },
          goalTitle: { type: "string" },
          pageTitle: { type: "string" },
          parentPageId: { type: "string" },
          confirmed: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  },
]);

function getOpenAIChatTools() {
  return OPENAI_CHAT_TOOLS.map((tool) => ({
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

/** Anthropic Messages API `tools` array (same JSON Schema as Zod). */
function getAnthropicTools() {
  return OPENAI_CHAT_TOOLS.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
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
  getOpenAIChatTools,
  getAnthropicTools,
  OPENAI_CHAT_TOOLS,
  isV1ToolName,
};
