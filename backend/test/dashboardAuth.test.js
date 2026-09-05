const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardAuth,
  extractBearerToken,
} = require('../src/middleware/auth');

const authUser = {
  id: 'auth-user-1',
  email: 'operator@example.test',
};
const operator = {
  id: '11111111-1111-4111-8111-111111111111',
  auth_user_id: authUser.id,
  name: 'Test Operator',
  email: authUser.email,
  role: 'operator',
};

function createResponse() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createHarness({ tokenResult, operatorResult } = {}) {
  const receivedTokens = [];
  const lookedUpAuthIds = [];
  const middleware = createDashboardAuth({
    logger: { info() {}, warn() {}, error() {} },
    async getUserByToken(token) {
      receivedTokens.push(token);
      return tokenResult ?? { data: { user: authUser }, error: null };
    },
    async findOperatorByAuthUserId(authUserId) {
      lookedUpAuthIds.push(authUserId);
      return operatorResult ?? { data: operator, error: null };
    },
  });

  async function invoke(headers = {}) {
    const req = { headers, originalUrl: '/api/test', method: 'GET' };
    const res = createResponse();
    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });
    return { req, res, nextCalled };
  }

  return { invoke, receivedTokens, lookedUpAuthIds };
}

test('extractBearerToken accepts only a bounded Bearer credential', () => {
  assert.equal(extractBearerToken('Bearer access-token'), 'access-token');
  assert.equal(extractBearerToken('bearer access-token'), 'access-token');
  assert.equal(extractBearerToken('Basic access-token'), null);
  assert.equal(extractBearerToken('Bearer '), null);
});

test('dashboard auth rejects a missing Authorization header', async () => {
  const harness = createHarness();
  const result = await harness.invoke();

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
  assert.equal(harness.receivedTokens.length, 0);
});

test('dashboard auth rejects an invalid or expired Supabase token', async () => {
  const harness = createHarness({
    tokenResult: { data: { user: null }, error: new Error('invalid token') },
  });
  const result = await harness.invoke({ authorization: 'Bearer invalid-token' });

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalled, false);
  assert.deepEqual(harness.receivedTokens, ['invalid-token']);
});

test('authenticated user without an admin_users link is forbidden', async () => {
  const harness = createHarness({ operatorResult: { data: null, error: null } });
  const result = await harness.invoke({ authorization: 'Bearer valid-token' });

  assert.equal(result.res.statusCode, 403);
  assert.equal(result.nextCalled, false);
  assert.deepEqual(harness.lookedUpAuthIds, [authUser.id]);
});

test('authorized operator is attached from the validated Supabase identity', async () => {
  const harness = createHarness();
  const result = await harness.invoke({
    authorization: 'Bearer valid-token',
    'x-admin-user-id': '99999999-9999-4999-8999-999999999999',
    'x-api-key': 'spoofed-shared-secret',
  });

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, null);
  assert.deepEqual(result.req.operator, {
    id: operator.id,
    authUserId: authUser.id,
    email: authUser.email,
    name: operator.name,
    role: operator.role,
  });
  assert.notEqual(result.req.operator.id, result.req.headers['x-admin-user-id']);
});
