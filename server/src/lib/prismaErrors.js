/**
 * Maps Prisma errors to a safe client-facing message (and logs the full error).
 */
function prismaErrorMessage(err) {
  if (!err) return "Internal server error";

  if (err.code === "P1001") {
    return "Cannot reach database. Check DATABASE_URL and that Postgres is running.";
  }
  // Column/table missing vs Prisma schema (migrations not applied)
  if (err.code === "P2022") {
    return 'Database is missing a column the app expects (e.g. User.name). From the server folder run: npx prisma migrate deploy';
  }
  if (err.code === "P2002") {
    return "This value is already in use.";
  }
  if (err.code === "P2025") {
    return "Record not found.";
  }

  return err.message || "Internal server error";
}

module.exports = { prismaErrorMessage };
