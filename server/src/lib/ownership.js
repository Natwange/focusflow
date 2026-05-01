async function requireOwnedResource({
  model,
  id,
  userId,
  res,
  notFoundMessage,
  forbiddenMessage,
  select = { id: true, userId: true },
}) {
  // Always load userId for ownership check, even when callers pass a narrow `select`.
  const record = await model.findUnique({
    where: { id },
    select: { ...select, userId: true },
  });

  if (!record) {
    res.status(404).json({ error: notFoundMessage });
    return null;
  }

  if (String(record.userId) !== String(userId)) {
    res.status(403).json({ error: forbiddenMessage });
    return null;
  }

  return record;
}

module.exports = { requireOwnedResource };
