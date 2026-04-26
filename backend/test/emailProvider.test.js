import assert from 'node:assert/strict';
import test from 'node:test';
import { dryRunSend, getEmailProviderConfig, validatePowerMtaConfig, validateTestMessage } from '../lib/emailProvider.js';

const withEnv = async (updates, fn) => {
  const originals = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await fn(); }
  finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('email provider config defaults to dry-run safe mode', () => {
  const config = getEmailProviderConfig({});
  assert.equal(config.provider, 'dry-run');
  assert.equal(config.sendMode, 'safe-test-only');
  assert.equal(config.realSendingEnabled, false);
  assert.equal(config.powerMtaConfigured, false);
});

test('PowerMTA config validation requires full SMTP settings and sender', () => {
  const result = validatePowerMtaConfig({ ORACLESTREET_POWERMTA_PORT: '587' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('powermta_host_required'));
  assert.ok(result.errors.includes('powermta_username_required'));
  assert.ok(result.errors.includes('powermta_password_required'));
  assert.ok(result.errors.includes('valid_default_from_email_required'));
});

test('PowerMTA config validation accepts complete controlled config', () => {
  const result = validatePowerMtaConfig({
    ORACLESTREET_POWERMTA_HOST: '127.0.0.1',
    ORACLESTREET_POWERMTA_PORT: '2525',
    ORACLESTREET_POWERMTA_USERNAME: 'test-user',
    ORACLESTREET_POWERMTA_PASSWORD: 'test-pass',
    ORACLESTREET_DEFAULT_FROM_EMAIL: 'sender@example.test'
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('test message requires consent, source, and unsubscribe language', () => {
  const result = validateTestMessage({ to: 'person@example.test', subject: 'Hello', html: '<p>Hello</p>' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('explicit_consent_required'));
  assert.ok(result.errors.includes('source_required'));
  assert.ok(result.errors.includes('unsubscribe_link_required'));
});

test('dry-run send accepts compliant owned test message without real delivery', async () => {
  await withEnv({ ORACLESTREET_MAIL_PROVIDER: 'dry-run' }, async () => {
    const result = dryRunSend({
      to: 'owned-inbox@example.test',
      subject: 'OracleStreet controlled test',
      html: '<p>Test message.</p><p><a href="https://example.test/unsubscribe">unsubscribe</a></p>',
      consentStatus: 'opt_in',
      source: 'owned controlled inbox'
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'dry-run');
    assert.equal(result.realDelivery, false);
    assert.equal(result.provider, 'dry-run');
  });
});

test('PowerMTA dry-run refuses missing provider config before any real send path', async () => {
  await withEnv({ ORACLESTREET_MAIL_PROVIDER: 'powermta', ORACLESTREET_POWERMTA_HOST: undefined }, async () => {
    const result = dryRunSend({
      to: 'owned-inbox@example.test',
      subject: 'OracleStreet controlled PMTA test',
      html: '<p>Test message.</p><p>unsubscribe</p>',
      consentStatus: 'opt_in',
      source: 'owned controlled inbox'
    });
    assert.equal(result.ok, false);
    assert.equal(result.provider, 'powermta');
    assert.ok(result.errors.includes('powermta_host_required'));
  });
});
