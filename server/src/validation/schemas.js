const { z } = require("zod");

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

const registerBodySchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: "Invalid email address" })
    .max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
  name: z.string().trim().min(1, "Name is required").max(120),
});

const loginBodySchema = z.object({
  email: z.string().trim().email({ message: "Invalid email address" }).max(254),
  password: z.string().min(1, "Password is required").max(128),
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

const goalCreateBodySchema = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  totalUnits: z.coerce.number().int().positive().max(100_000),
  unitName: z.string().trim().min(1, "unitName is required").max(80),
  deadline: isoLikeString,
});

const journalNoteCreateBodySchema = z.object({
  title: z.string().max(500).default(""),
  content: z.string().max(50_000).default(""),
  font_style: z
    .enum(["playful", "balanced", "professional"])
    .default("balanced"),
});

module.exports = {
  registerBodySchema,
  loginBodySchema,
  taskCreateBodySchema,
  taskUpdateBodySchema,
  taskStatusBodySchema,
  goalCreateBodySchema,
  journalNoteCreateBodySchema,
};
