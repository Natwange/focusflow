require("dotenv").config();

const { Pool } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

// Force sslmode=no-verify so pg accepts self-signed certs (Neon, Aiven, Supabase, etc.).
// The connection string parser overwrites our ssl config, so we must set it in the URL.
function connectionStringWithNoVerify(url) {
  if (!url) return url;
  const hasParams = url.includes("?");
  const base = hasParams ? url.replace(/\?.*/, "") : url;
  const params = hasParams ? new URLSearchParams(url.slice(url.indexOf("?") + 1)) : new URLSearchParams();
  params.set("sslmode", "no-verify");
  return `${base}?${params.toString()}`;
}

const pool = new Pool({
  connectionString: connectionStringWithNoVerify(process.env.DATABASE_URL),
});

const adapter = new PrismaPg(pool, { disposeExternalPool: false });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;

