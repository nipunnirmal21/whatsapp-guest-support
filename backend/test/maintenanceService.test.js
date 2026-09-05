const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMaintenanceService,
} = require('../src/services/maintenance/service');

function createHarness() {
  const rows = [];
  const service = createMaintenanceService({
    logger: { info() {}, warn() {}, error() {} },
    async findOpenMaintenanceCase({ conversationId, apartmentId, description }) {
      return rows.find(
        (row) =>
          row.conversation_id === conversationId &&
          row.apartment_id === apartmentId &&
          row.description === description &&
          ['open', 'in_progress'].includes(row.status)
      ) ?? null;
    },
    async insertMaintenanceCase(payload) {
      const row = {
        id: `maintenance-${rows.length + 1}`,
        status: 'open',
        ...payload,
      };
      rows.push(row);
      return row;
    },
  });

  return { service, rows };
}

test('maintenance request creates one open case and reuses it on retry', async () => {
  const harness = createHarness();
  const request = {
    conversationId: 'conversation-1',
    apartmentId: 'apartment-1',
    description: 'The shower is leaking.',
  };

  const first = await harness.service.ensureMaintenanceCase(request);
  const retry = await harness.service.ensureMaintenanceCase(request);

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.maintenanceCase.id, first.maintenanceCase.id);
  assert.equal(harness.rows.length, 1);
  assert.deepEqual(harness.rows[0], {
    id: 'maintenance-1',
    status: 'open',
    conversation_id: 'conversation-1',
    apartment_id: 'apartment-1',
    description: 'The shower is leaking.',
  });
});

test('unverified reservation does not fabricate an apartment relationship', async () => {
  const harness = createHarness();

  const result = await harness.service.ensureMaintenanceCase({
    conversationId: 'conversation-2',
    apartmentId: null,
    description: 'The door lock is broken.',
  });

  assert.equal(result.skipped, true);
  assert.equal(result.maintenanceCase, null);
  assert.equal(harness.rows.length, 0);
});
