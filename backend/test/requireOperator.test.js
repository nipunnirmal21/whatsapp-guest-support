const test = require('node:test');
const assert = require('node:assert/strict');

const requireOperator = require('../src/middleware/requireOperator');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('operator middleware rejects missing server-derived identity despite spoofed header', () => {
  const req = {
    headers: { 'x-admin-user-id': '11111111-1111-4111-8111-111111111111' },
    originalUrl: '/api/escalations/e/take-over',
    method: 'POST',
  };
  const res = createResponse();

  requireOperator(req, res, () => assert.fail('next should not be called'));

  assert.equal(res.statusCode, 401);
});

test('operator middleware rejects a server-derived unauthorized role', () => {
  const req = {
    headers: {},
    operator: { id: 'operator-1', role: 'viewer' },
    originalUrl: '/api/conversations/c/manual-mode',
    method: 'POST',
  };
  const res = createResponse();

  requireOperator(req, res, () => assert.fail('next should not be called'));

  assert.equal(res.statusCode, 403);
});

test('operator middleware accepts identity resolved by dashboard authentication', () => {
  const req = {
    headers: {},
    operator: { id: 'operator-1', role: 'operator' },
    originalUrl: '/api/conversations/c/manual-mode',
    method: 'POST',
  };
  const res = createResponse();
  let called = false;

  requireOperator(req, res, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.adminUserId, undefined);
});
