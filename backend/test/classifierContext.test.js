const test = require('node:test');
const assert = require('node:assert/strict');

const { buildModelContext } = require('../src/services/ai/classifier');

test('classifier context carries reservation identity-verification state', () => {
  const result = buildModelContext({
    identity_verification: {
      status: 'provisional',
      method: 'guest_name',
      reason: 'booking_id_verification_required',
    },
  });

  assert.equal(result.reservation, null);
  assert.deepEqual(result.identity_verification, {
    status: 'provisional',
    method: 'guest_name',
    reason: 'booking_id_verification_required',
  });
});
