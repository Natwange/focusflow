require("dotenv").config();
const { createApp } = require("./app");
const PORT = process.env.PORT || 4000;
const app = createApp();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
}

module.exports = { app };
