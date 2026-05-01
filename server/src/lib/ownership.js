async function requireOwnedResource({
  model,
  id,
  userId,
  res,
  notFoundMessage,
  forbiddenMessage,
  select = { id: true, userId: true },
}) {
  const record = await model.findUnique({ where: { id }, select });

  if (!record) {
    res.status(404).json({ error: notFoundMessage });
    return null;
  }

  if (record.userId !== userId) {
    res.status(403).json({ error: forbiddenMessage });
    return null;
  }

  return record;
}

module.exports = { requireOwnedResource };
