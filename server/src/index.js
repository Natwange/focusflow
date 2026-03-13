const express = require("express");
const cors = require("cors");
require("dotenv").config();
const authRoutes = require("./routes/auth");

const auth = require("./middleware/auth");
const goalRoutes = require("./routes/goals");
const taskRoutes = require("./routes/tasks");
const analyticsRoutes = require("./routes/analytics");
const journalRoutes = require("./routes/journal");
const focusRoutes = require("./routes/focus");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/goals", auth, goalRoutes);
app.use("/tasks", auth, taskRoutes);
app.use("/analytics", auth, analyticsRoutes);
app.use("/journal", auth, journalRoutes);
app.use("/focus", auth, focusRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;

app.get("/me", auth, (req, res) => {
  res.json({ user: req.user });
});


app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
