const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isConversationAutomationPaused,
} = require('../src/services/conversations/automation');

test('automation pauses for escalated and manual conversations', () => {
  assert.equal(isConversationAutomationPaused({ status: 'escalated' }), true);
  assert.equal(isConversationAutomationPaused({ status: 'manual' }), true);
  assert.equal(isConversationAutomationPaused({ status: ' MANUAL ' }), true);
});

test('automation remains active for open or missing conversation status', () => {
  assert.equal(isConversationAutomationPaused({ status: 'open' }), false);
  assert.equal(isConversationAutomationPaused({ status: 'resolved' }), false);
  assert.equal(isConversationAutomationPaused(null), false);
});

