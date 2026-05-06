const { z } = require("zod");
const {
  normalizeEmailInput,
  isReasonableEmailShape,
} = require("../lib/emailPolicy");

const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
const taskStatusSchema = z.enum(["todo", "doing", "done"]);

const goalIdCreateField = z
  .union([z.string().trim().min(1).max(64), z.literal(""), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    return v;
  });

const goalIdUpdateField = z
  .union([z.string().trim().min(1).max(64), z.literal(""), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === "" || v === null) return null;
    return v;
  });

const isoLikeString = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

/** Login, register, forgot-password: normalized + format + “real-looking” domain. */
const emailSchemaForAuth = z
  .string()
  .trim()
  .transform((s) => normalizeEmailInput(s))
  .pipe(
    z
      .string()
      .email({ message: "Invalid email address" })
      .max(254)
      .refine(isReasonableEmailShape, {
        message:
          "Enter a real email with a domain (for example you@gmail.com).",
      })
  );

const registerBodySchema = z.object({
  email: emailSchemaForAuth,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
  name: z.string().trim().min(1, "Name is required").max(120),
});

const loginBodySchema = z.object({
  email: emailSchemaForAuth,
  password: z.string().min(1, "Password is required").max(128),
});

const forgotPasswordBodySchema = z.object({
  email: emailSchemaForAuth,
});

const resetPasswordBodySchema = z.object({
  token: z.string().trim().min(1, "Reset link is missing or invalid"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
});

const verifyEmailBodySchema = z.object({
  token: z.string().trim().min(1, "Verification link is missing or invalid"),
});

const taskCreateBodySchema = z.object({
  title: z.string().trim().min(1, "title is required").max(500),
  goalId: goalIdCreateField,
  estimatedMin: z
    .union([z.coerce.number().int().nonnegative(), z.null()])
    .optional(),
  dueDate: z.union([isoLikeString, z.null()]).optional(),
  priority: taskPrioritySchema.optional(),
});

const taskUpdateBodySchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  dueDate: z.union([isoLikeString, z.null()]).optional(),
  estimatedMin: z
    .union([z.coerce.number().int().nonnegative(), z.null()])
    .optional(),
  goalId: goalIdUpdateField,
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
});

const taskStatusBodySchema = z.object({
  status: taskStatusSchema,
});

const weekdaySchema = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

const goalCreateBodySchema = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  totalUnits: z.coerce.number().int().positive().max(100_000),
  unitName: z.string().trim().min(1, "unitName is required").max(80),
  deadline: isoLikeString,
  availableDays: z.array(weekdaySchema).max(7).optional(),
  // Zod v4: preprocess + inner .optional() rejects *omitted* keys; use optional(union) instead.
  maxUnitsPerDay: z.optional(
    z.union([
      z.literal("").transform(() => undefined),
      z.null().transform(() => undefined),
      z.coerce.number().int().positive().max(10_000),
    ])
  ),
});

const journalNoteCreateBodySchema = z.object({
  title: z.string().max(500).default(""),
  content: z.string().max(50_000).default(""),
  font_style: z
    .enum(["playful", "balanced", "professional"])
    .default("balanced"),
});

const rebalanceStrategySchema = z.enum([
  "keep_deadline",
  "spread_evenly",
  "increase_daily_load",
  "extend_deadline",
]);

const rebalanceConfirmBodySchema = z.object({
  strategy: rebalanceStrategySchema,
});

module.exports = {
  registerBodySchema,
  loginBodySchema,
  forgotPasswordBodySchema,
  resetPasswordBodySchema,
  verifyEmailBodySchema,
  taskCreateBodySchema,
  taskUpdateBodySchema,
  taskStatusBodySchema,
  goalCreateBodySchema,
  journalNoteCreateBodySchema,
  rebalanceConfirmBodySchema,
};
