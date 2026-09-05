const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'app.js'),
  'utf8'
);

test('health and WhatsApp webhook routes stay outside dashboard authentication', () => {
  const healthIndex = appSource.indexOf("app.get('/health'");
  const webhookGetIndex = appSource.indexOf("app.use('/webhooks/whatsapp'");
  const webhookPostIndex = appSource.search(
    /app\.post\(\s*['"]\/webhooks\/whatsapp['"]/
  );
  const authIndex = appSource.indexOf("app.use('/api', requireDashboardAuth)");

  assert.ok(healthIndex >= 0, 'health route must exist');
  assert.ok(webhookGetIndex >= 0, 'webhook GET route must exist');
  assert.ok(webhookPostIndex >= 0, 'webhook POST route must exist');
  assert.ok(authIndex >= 0, 'dashboard authentication boundary must exist');
  assert.ok(healthIndex < authIndex);
  assert.ok(webhookGetIndex < authIndex);
  assert.ok(webhookPostIndex < authIndex);
});

test('all dashboard routers are mounted beneath the authenticated API boundary', () => {
  const authIndex = appSource.indexOf("app.use('/api', requireDashboardAuth)");
  const dashboardMounts = [
    "app.use('/api/messages'",
    "app.use('/api/conversations'",
    "app.use('/api/escalations'",
    "app.use('/api/intents'",
    "app.use('/api/settings'",
    "app.use('/api/admin-users'",
  ];

  for (const mount of dashboardMounts) {
    assert.ok(appSource.indexOf(mount) > authIndex, `${mount} must follow authentication`);
  }
});
