import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthenticatedFetch } from '../src/services/api.js';

function response(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

function createSupabaseHarness({ initialToken = 'token-1', refreshedToken = 'token-2' } = {}) {
  const signOutCalls = [];
  return {
    signOutCalls,
    client: {
      auth: {
        async getSession() {
          return {
            data: {
              session: initialToken ? { access_token: initialToken } : null,
            },
            error: null,
          };
        },
        async refreshSession() {
          return {
            data: {
              session: refreshedToken ? { access_token: refreshedToken } : null,
            },
            error: refreshedToken ? null : new Error('refresh failed'),
          };
        },
        async signOut(options) {
          signOutCalls.push(options);
        },
      },
    },
  };
}

test('authenticated API requests send only the Supabase Bearer token', async () => {
  const harness = createSupabaseHarness();
  const calls = [];
  const request = createAuthenticatedFetch({
    supabaseClient: harness.client,
    apiBase: 'https://api.example.test',
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return response(200, { data: [] });
    },
  });

  await request('/api/conversations');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer token-1');
  assert.equal(calls[0].options.headers.has('X-API-Key'), false);
  assert.equal(calls[0].options.headers.has('X-Admin-User-Id'), false);
});

test('a 401 refreshes once and retries with the refreshed session', async () => {
  const harness = createSupabaseHarness();
  const tokens = [];
  const request = createAuthenticatedFetch({
    supabaseClient: harness.client,
    async fetchImpl(_url, options) {
      tokens.push(options.headers.get('Authorization'));
      return tokens.length === 1
        ? response(401, { error: 'expired' })
        : response(200, { data: 'ok' });
    },
  });

  const result = await request('/api/test');

  assert.equal(result.data, 'ok');
  assert.deepEqual(tokens, ['Bearer token-1', 'Bearer token-2']);
});

test('an unrecoverable 401 signs out locally and returns to login', async () => {
  const harness = createSupabaseHarness({ refreshedToken: null });
  const notices = [];
  const request = createAuthenticatedFetch({
    supabaseClient: harness.client,
    onUnauthorized(message) {
      notices.push(message);
    },
    async fetchImpl() {
      return response(401, { error: 'expired' });
    },
  });

  await assert.rejects(() => request('/api/test'), /expired/);
  assert.deepEqual(harness.signOutCalls, [{ scope: 'local' }]);
  assert.equal(notices.length, 1);
});
