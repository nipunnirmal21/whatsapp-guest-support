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

test('operator middleware rejects a missing identity', () => {
  const req = { headers: {}, originalUrl: '/api/escalations/e/take-over', method: 'POST' };
  const res = createResponse();
  let called = false;

  requireOperator(req, res, () => {
    called = true;
  });

  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});

test('operator middleware rejects a malformed UUID', () => {
  const req = {
    headers: { 'x-admin-user-id': 'not-a-uuid' },
    originalUrl: '/api/conversations/c/manual-mode',
    method: 'POST',
  };
  const res = createResponse();

  requireOperator(req, res, () => assert.fail('next should not be called'));

  assert.equal(res.statusCode, 400);
});

test('operator middleware attaches a valid admin user id', () => {
  const operatorId = '11111111-1111-4111-8111-111111111111';
  const req = {
    headers: { 'x-admin-user-id': operatorId },
    originalUrl: '/api/conversations/c/manual-mode',
    method: 'POST',
  };
  const res = createResponse();
  let called = false;

  requireOperator(req, res, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(req.adminUserId, operatorId);
  assert.equal(res.statusCode, null);
});

