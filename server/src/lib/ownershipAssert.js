/**
 * Ownership checks without Express res — for agent tools and other non-HTTP callers.
 */

async function findOwnedResource({
  model,
  id,
  userId,
  select = { id: true, userId: true },
  notFoundMessage = "Resource not found",
  forbiddenMessage = "Forbidden: resource does not belong to this user",
}) {
  const record = await model.findUnique({
    where: { id },
    select: { ...select, userId: true },
  });

  if (!record) {
    return { ok: false, error: notFoundMessage, code: "NOT_FOUND", record: null };
  }

  if (String(record.userId) !== String(userId)) {
    return { ok: false, error: forbiddenMessage, code: "FORBIDDEN", record: null };
  }

  return { ok: true, record, error: null, code: null };
}

module.exports = { findOwnedResource };
