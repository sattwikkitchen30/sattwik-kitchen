const test = require('node:test');
const assert = require('node:assert/strict');
const migrateTiffinSubscriptionIndexes = require('./migrateTiffinSubscriptionIndexes');

test('drops only the legacy unique orderId subscription index', async () => {
  const dropped = [];
  const calls = [];
  const model = {
    db: { db: { listCollections: () => ({ hasNext: async () => true }) } },
    collection: {
      collectionName: 'tiffinsubscriptions',
      indexes: async () => [
        { name: '_id_', key: { _id: 1 } },
        { name: 'orderId_1', key: { orderId: 1 }, unique: true },
        { name: 'orderId_1_packageType_1_size_1', key: { orderId: 1, packageType: 1, size: 1 }, unique: true }
      ],
      dropIndex: async (name) => {
        dropped.push(name);
        calls.push('drop');
      }
    },
    createIndexes: async () => calls.push('create')
  };

  await migrateTiffinSubscriptionIndexes(model);

  assert.deepEqual(dropped, ['orderId_1']);
  assert.deepEqual(calls, ['drop', 'create']);
});

test('does not drop a non-unique or compound orderId index', async () => {
  const dropped = [];
  const model = {
    db: { db: { listCollections: () => ({ hasNext: async () => true }) } },
    collection: {
      collectionName: 'tiffinsubscriptions',
      indexes: async () => [
        { name: 'orderId_1', key: { orderId: 1 } },
        { name: 'orderId_1_packageType_1_size_1', key: { orderId: 1, packageType: 1, size: 1 }, unique: true }
      ],
      dropIndex: async (name) => dropped.push(name)
    },
    createIndexes: async () => {}
  };

  await migrateTiffinSubscriptionIndexes(model);

  assert.deepEqual(dropped, []);
});

test('creates the collection before reading indexes on a fresh database', async () => {
  const calls = [];
  const model = {
    db: { db: { listCollections: () => ({ hasNext: async () => false }) } },
    collection: {
      collectionName: 'tiffinsubscriptions',
      indexes: async () => {
        calls.push('indexes');
        return [];
      },
      dropIndex: async () => {}
    },
    createCollection: async () => calls.push('createCollection'),
    createIndexes: async () => calls.push('createIndexes')
  };

  await migrateTiffinSubscriptionIndexes(model);

  assert.deepEqual(calls, ['createCollection', 'indexes', 'createIndexes']);
});
