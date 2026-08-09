const test = require('node:test');
const assert = require('node:assert/strict');

const { runRulesEngine } = require('../src/services/rules/engine');

function dateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function context(overrides = {}) {
  return {
    reservation: {
      id: 'reservation-1',
      status: 'confirmed',
      checkin_date: dateOffset(1),
      checkout_date: dateOffset(5),
      ...overrides.reservation,
    },
    apartment: {
      id: 'apartment-1',
      name: 'Ocean View',
      address: '1 Beach Road',
      map_link: 'https://maps.example.test/ocean-view',
      wifi_details: { ssid: 'OceanGuest', password: 'safe-password' },
      policy: {
        checkin_time: '14:00:00',
        checkout_time: '11:00:00',
        parking_info: 'Use bay 12.',
        ...overrides.policy,
      },
      ...overrides.apartment,
    },
  };
}

test('rules engine returns structured Wi-Fi and parking replies', async () => {
  const data = context();
  const wifi = await runRulesEngine(
    'What is the Wi-Fi password?',
    data.reservation,
    data.apartment
  );
  const parking = await runRulesEngine(
    'Where should I park my car?',
    data.reservation,
    data.apartment
  );

  assert.equal(wifi.outcome, 'auto_reply');
  assert.match(wifi.reply, /OceanGuest/);
  assert.equal(parking.outcome, 'auto_reply');
  assert.match(parking.reply, /bay 12/);
});

test('rules engine returns reservation-specific check-in and checkout details', async () => {
  const data = context();
  const checkin = await runRulesEngine(
    'What is the check-in time and address?',
    data.reservation,
    data.apartment
  );
  const checkout = await runRulesEngine(
    'When is checkout?',
    data.reservation,
    data.apartment
  );

  assert.equal(checkin.outcome, 'auto_reply');
  assert.match(checkin.reply, /2:00 PM/);
  assert.match(checkin.reply, /1 Beach Road/);
  assert.equal(checkout.outcome, 'auto_reply');
  assert.match(checkout.reply, /11:00 AM/);
});

test('rules engine refuses to invent missing or inactive reservation details', async () => {
  const missing = context({
    apartment: { wifi_details: null },
    policy: { parking_info: null },
  });
  const inactive = context({
    reservation: { status: 'checked_out', checkout_date: dateOffset(-1) },
  });

  const wifi = await runRulesEngine('wifi please', missing.reservation, missing.apartment);
  const parking = await runRulesEngine(
    'parking please',
    missing.reservation,
    missing.apartment
  );
  const checkout = await runRulesEngine(
    'checkout time?',
    inactive.reservation,
    inactive.apartment
  );

  assert.equal(wifi.outcome, 'unhandled');
  assert.equal(parking.outcome, 'unhandled');
  assert.equal(checkout.outcome, 'unhandled');
});

test('rules engine leaves empty and unknown messages for the classifier', async () => {
  const data = context();
  assert.deepEqual(await runRulesEngine('', data.reservation, data.apartment), {
    outcome: 'unhandled',
    reply: null,
  });
  assert.deepEqual(
    await runRulesEngine('I have another question', data.reservation, data.apartment),
    { outcome: 'unhandled', reply: null }
  );
});
