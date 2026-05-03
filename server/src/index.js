require("dotenv").config();
const { createApp } = require("./app");
const PORT = process.env.PORT || 4000;
const app = createApp();

if (require.main === module) {
  const host = process.env.HOST || "0.0.0.0";
  app.listen(PORT, host, () => {
    console.log(`API listening on http://${host}:${PORT}`);
  });
}

module.exports = { app };
