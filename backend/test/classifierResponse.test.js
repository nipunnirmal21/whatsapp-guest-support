const test = require('node:test');
const assert = require('node:assert/strict');

const { parseModelResponse } = require('../src/services/ai/classifier');

test('classifier parser accepts and normalises supported JSON responses', () => {
  assert.deepEqual(
    parseModelResponse('{"classification":"safe_reply","draft":"  Welcome!  "}'),
    { classification: 'safe_reply', draft: 'Welcome!' }
  );
  assert.deepEqual(
    parseModelResponse('{"classification":"human_handover","draft":null}'),
    { classification: 'human_handover', draft: null }
  );
});

test('classifier parser rejects malformed or unsafe model responses', () => {
  assert.throws(() => parseModelResponse('not json'), /invalid JSON/i);
  assert.throws(
    () => parseModelResponse('{"classification":"invented","draft":"Hi"}'),
    /invalid classification/i
  );
  assert.throws(
    () => parseModelResponse('{"classification":"safe_reply","draft":null}'),
    /without a draft/i
  );
});
