const test = require('node:test');
const assert = require('node:assert/strict');

const requireDashboardAuth = require('../src/middleware/auth');

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

function invoke(headers = {}) {
  const response = createResponse();
  let nextCalled = false;
  requireDashboardAuth(
    { headers, originalUrl: '/api/test', method: 'GET' },
    response,
    () => {
      nextCalled = true;
    }
  );
  return { response, nextCalled };
}

test('dashboard auth fails closed when the server key is missing', () => {
  const previousKey = process.env.DASHBOARD_API_KEY;
  delete process.env.DASHBOARD_API_KEY;

  try {
    const result = invoke({ 'x-api-key': 'provided-key' });
    assert.equal(result.response.statusCode, 500);
    assert.equal(result.nextCalled, false);
  } finally {
    if (previousKey === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = previousKey;
  }
});

test('dashboard auth rejects missing and invalid credentials', () => {
  const previousKey = process.env.DASHBOARD_API_KEY;
  process.env.DASHBOARD_API_KEY = 'expected-dashboard-key';

  try {
    const missing = invoke();
    assert.equal(missing.response.statusCode, 401);

    const invalid = invoke({ 'x-api-key': 'wrong-dashboard-key' });
    assert.equal(invalid.response.statusCode, 401);
    assert.equal(invalid.nextCalled, false);
  } finally {
    if (previousKey === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = previousKey;
  }
});

test('dashboard auth accepts API-key and bearer credentials', () => {
  const previousKey = process.env.DASHBOARD_API_KEY;
  process.env.DASHBOARD_API_KEY = 'expected-dashboard-key';

  try {
    const apiKey = invoke({ 'x-api-key': 'expected-dashboard-key' });
    assert.equal(apiKey.nextCalled, true);

    const bearer = invoke({ authorization: 'Bearer expected-dashboard-key' });
    assert.equal(bearer.nextCalled, true);
  } finally {
    if (previousKey === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = previousKey;
  }
});
