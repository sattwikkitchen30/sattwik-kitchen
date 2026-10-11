async function migrateTiffinSubscriptionIndexes(model) {
  const collectionExists = await model.db.db
    .listCollections({ name: model.collection.collectionName }, { nameOnly: true })
    .hasNext();
  if (!collectionExists) {
    await model.createCollection();
  }

  const indexes = await model.collection.indexes();
  const legacyOrderIdIndex = indexes.find((index) => (
    index.unique
    && Object.keys(index.key || {}).length === 1
    && index.key.orderId === 1
  ));

  if (legacyOrderIdIndex) {
    await model.collection.dropIndex(legacyOrderIdIndex.name);
  }

  await model.createIndexes();
}

module.exports = migrateTiffinSubscriptionIndexes;
