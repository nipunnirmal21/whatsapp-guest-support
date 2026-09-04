const test = require('node:test');
const assert = require('node:assert/strict');
const { runRulesEngine } = require('../src/services/rules/engine');

const reservation = {
  id: 'reservation-test-id',
  status: 'confirmed',
  checkin_date: '2099-01-01',
  checkout_date: '2099-01-05',
};

const apartment = {
  id: 'apartment-test-id',
  name: 'Test Apartment',
  address: 'Test Address',
  map_link: 'https://example.test/directions',
  wifi_details: {
    ssid: 'TestNetwork',
    password: 'test-password',
  },
  policy: {
    checkin_time: '14:00:00',
    checkout_time: '11:00:00',
    parking_info: 'Use test bay 1.',
  },
};

test('preserves deterministic structured replies', async () => {
  const wifi = await runRulesEngine(
    'What is the Wi-Fi password?',
    reservation,
    apartment
  );
  const parking = await runRulesEngine('Where can I park?', reservation, apartment);
  const checkin = await runRulesEngine('What time is check-in?', reservation, apartment);
  const checkout = await runRulesEngine('What time is checkout?', reservation, apartment);

  assert.equal(wifi.outcome, 'auto_reply');
  assert.match(wifi.reply, /TestNetwork/);
  assert.match(wifi.reply, /test-password/);
  assert.equal(parking.outcome, 'auto_reply');
  assert.match(parking.reply, /Use test bay 1/);
  assert.equal(checkin.outcome, 'auto_reply');
  assert.match(checkin.reply, /2:00 PM/);
  assert.equal(checkout.outcome, 'auto_reply');
  assert.match(checkout.reply, /11:00 AM/);
});

test('routes approval and sensitive decision intents to human handover', async () => {
  const scenarios = [
    ['Can I check in at 11 AM?', 'early check-in request'],
    ['Can I check out at 1 PM?', 'late check-out request'],
    ['I want a refund.', 'refund request'],
    ['Can you compensate me for this?', 'compensation request'],
    ['Is there an early check-in fee?', 'early check-in request'],
  ];

  for (const [message, reason] of scenarios) {
    const result = await runRulesEngine(message, reservation, apartment);
    assert.equal(result.outcome, 'human_handover', message);
    assert.equal(result.reason, reason, message);
  }
});

test('routes maintenance and explicit human requests to human handover', async () => {
  const maintenance = await runRulesEngine(
    'The air conditioner is not working.',
    reservation,
    apartment
  );
  const human = await runRulesEngine(
    'I want to speak to someone.',
    reservation,
    apartment
  );

  assert.equal(maintenance.outcome, 'human_handover');
  assert.equal(maintenance.reason, 'maintenance issue');
  assert.equal(human.outcome, 'human_handover');
  assert.equal(human.reason, 'guest requested human support');
});

test('does not send protected factual requests to AI when structured data is missing', async () => {
  const wifi = await runRulesEngine('What is the Wi-Fi password?', reservation, null);
  const checkin = await runRulesEngine('What time is check-in?', reservation, null);

  assert.equal(wifi.outcome, 'human_handover');
  assert.equal(checkin.outcome, 'human_handover');
});
