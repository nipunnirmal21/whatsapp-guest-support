import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getDeliveryStatusPresentation,
  normaliseDeliveryStatus,
} from '../src/services/messageDelivery.js';

test('normalises supported WhatsApp delivery statuses', () => {
  assert.equal(normaliseDeliveryStatus(' Delivered '), 'delivered');
  assert.equal(normaliseDeliveryStatus('READ'), 'read');
  assert.equal(normaliseDeliveryStatus('unknown'), null);
});

test('maps statuses to dashboard labels and tones', () => {
  assert.deepEqual(getDeliveryStatusPresentation('sent'), {
    status: 'sent',
    label: '✓ Sent',
    tone: 'muted',
  });
  assert.equal(getDeliveryStatusPresentation('read').label, '✓✓ Read');
  assert.equal(getDeliveryStatusPresentation('failed').tone, 'error');
});
