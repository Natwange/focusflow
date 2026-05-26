const express = require("express");
const { z } = require("zod");
const { run: runAgentChat } = require("../agent/chatOrchestrator");
const { validateBody } = require("../middleware/validateBody");
const { prismaErrorMessage } = require("../lib/prismaErrors");

const router = express.Router();

const agentChatBodySchema = z.object({
  message: z.string().trim().min(1, "message is required").max(2000),
  tzOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(2000),
      })
    )
    .max(50)
    .optional(),
});

function parseTzFromBody(body) {
  if (body.tzOffsetMinutes === undefined) return 0;
  return body.tzOffsetMinutes;
}

/**
 * POST /agent/chat — LLM tool-calling with rule-based fallback when unconfigured.
 */
router.post("/chat", validateBody(agentChatBodySchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { message, history } = req.body;
    const tzOffsetMinutes = parseTzFromBody(req.body);

    const payload = await runAgentChat({
      userId,
      message,
      tzOffsetMinutes,
      history: history ?? [],
    });

    return res.json(payload);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: prismaErrorMessage(err) });
  }
});

module.exports = router;
