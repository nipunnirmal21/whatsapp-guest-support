const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const validateWebhookSignature = require('../src/middleware/validateWebhookSignature');

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

function invoke({ signature, rawBody = Buffer.from('{}') } = {}) {
  const response = createResponse();
  let nextCalled = false;
  validateWebhookSignature(
    {
      headers: signature ? { 'x-hub-signature-256': signature } : {},
      rawBody,
    },
    response,
    () => {
      nextCalled = true;
    }
  );
  return { response, nextCalled };
}

test('webhook signature validation rejects missing configuration and headers', () => {
  const previousSecret = process.env.META_APP_SECRET;

  try {
    process.env.META_APP_SECRET = 'test-secret';
    const missingHeader = invoke();
    assert.equal(missingHeader.response.statusCode, 403);

    delete process.env.META_APP_SECRET;
    const missingConfig = invoke({ signature: 'sha256=invalid' });
    assert.equal(missingConfig.response.statusCode, 500);
  } finally {
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
  }
});

test('webhook signature validation rejects incorrect signatures safely', () => {
  const previousSecret = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = 'test-secret';

  try {
    const wrongLength = invoke({ signature: 'sha256=short' });
    assert.equal(wrongLength.response.statusCode, 403);

    const correctLength = invoke({ signature: `sha256=${'0'.repeat(64)}` });
    assert.equal(correctLength.response.statusCode, 403);
    assert.equal(correctLength.nextCalled, false);
  } finally {
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
  }
});

test('webhook signature validation accepts the exact raw-body HMAC', () => {
  const previousSecret = process.env.META_APP_SECRET;
  const secret = 'test-secret';
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
  process.env.META_APP_SECRET = secret;

  try {
    const signature = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    const result = invoke({ signature, rawBody });
    assert.equal(result.nextCalled, true);
    assert.equal(result.response.statusCode, null);
  } finally {
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
  }
});
