async function loginAs(agent, { email, password }) {
  return agent.post("/auth/login").send({ email, password });
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  loginAs,
  sleepMs,
};
