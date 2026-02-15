const express = require("express");
const prisma = require("../lib/prisma");

const router = express.Router();

// Map Prisma model to client-expected shape (snake_case)
function toClient(note) {
  if (!note) return null;
  return {
    id: note.id,
    user_id: note.userId,
    title: note.title ?? "",
    content: note.content ?? "",
    font_style: note.fontStyle ?? "balanced",
    created_at: note.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updated_at: note.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

// GET /journal/notes/:id – get a single note
router.get("/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const note = await prisma.journalNote.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }
    return res.json(toClient(note));
  } catch (err) {
    console.error("Journal get note error:", err);
    return res.status(500).json({ error: "Failed to load note" });
  }
});

// GET /journal/notes – list current user's notes (newest first)
router.get("/notes", async (req, res) => {
  try {
    const notes = await prisma.journalNote.findMany({
      where: { userId: req.user.id },
      orderBy: { updatedAt: "desc" },
    });
    return res.json(notes.map(toClient));
  } catch (err) {
    console.error("Journal list error:", err);
    return res.status(500).json({ error: "Failed to load notes" });
  }
});

// POST /journal/notes – create a note
router.post("/notes", async (req, res) => {
  try {
    const { title = "", content = "", font_style = "balanced" } = req.body;
    const note = await prisma.journalNote.create({
      data: {
        userId: req.user.id,
        title: String(title),
        content: String(content),
        fontStyle: String(font_style),
      },
    });
    return res.status(201).json(toClient(note));
  } catch (err) {
    console.error("Journal create error:", err);
    return res.status(500).json({ error: "Failed to create note" });
  }
});

// PATCH /journal/notes/:id – update a note
router.patch("/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, font_style } = req.body;
    const note = await prisma.journalNote.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }
    const updated = await prisma.journalNote.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: String(title) }),
        ...(content !== undefined && { content: String(content) }),
        ...(font_style !== undefined && { fontStyle: String(font_style) }),
      },
    });
    return res.json(toClient(updated));
  } catch (err) {
    console.error("Journal update error:", err);
    return res.status(500).json({ error: "Failed to update note" });
  }
});

// DELETE /journal/notes/:id
router.delete("/notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const note = await prisma.journalNote.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }
    await prisma.journalNote.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    console.error("Journal delete error:", err);
    return res.status(500).json({ error: "Failed to delete note" });
  }
});

module.exports = router;
