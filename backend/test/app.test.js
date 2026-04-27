import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createHandler } from '../app.js';
import { resetAuditLogForTests } from '../lib/auditLog.js';
import { resetContactsForTests } from '../lib/contacts.js';
import { validateDatabaseConfig } from '../lib/database.js';
import { resetEmailEventsForTests } from '../lib/emailEvents.js';
import { resetSendQueueForTests } from '../lib/sendQueue.js';
import { resetSuppressionsForTests } from '../lib/suppressions.js';

const request = async (path, options = {}) => {
  const server = http.createServer(createHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, options);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), headers: res.headers };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const withEnv = async (updates, fn) => {
  const originals = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('health endpoint returns OracleStreet service metadata', async () => {
  const res = await request('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.service, 'oraclestreet-backend');
  assert.equal(res.body.scope, 'affiliate-email-cms');
  assert.equal(res.body.auth, 'admin-session');
});

test('email config endpoint defaults to dry-run safe mode', async () => {
  await withEnv({ ORACLESTREET_MAIL_PROVIDER: undefined, ORACLESTREET_REAL_EMAIL_ENABLED: undefined }, async () => {
    const res = await request('/api/email/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.provider, 'dry-run');
    assert.equal(res.body.sendMode, 'safe-test-only');
    assert.equal(res.body.realSendingEnabled, false);
  });
});

test('auth session reports unauthenticated without a cookie', async () => {
  const res = await request('/api/auth/session');
  assert.equal(res.status, 200);
  assert.equal(res.body.authenticated, false);
  assert.equal(res.body.user, null);
});

test('admin login rejects requests before bootstrap password exists', async () => {
  await withEnv({ ORACLESTREET_ADMIN_PASSWORD: undefined }, async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@oraclestreet.local', password: 'anything' })
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'admin_not_bootstrapped');
  });
});

test('admin login creates an http-only session cookie', async () => {
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable'
  }, async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'correct-horse-battery-staple' })
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, 'admin@example.test');
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /oraclestreet_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const session = await request('/api/auth/session', { headers: { cookie } });
    assert.equal(session.status, 200);
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.user.email, 'admin@example.test');
  });
});

test('admin login rejects invalid credentials', async () => {
  await withEnv({ ORACLESTREET_ADMIN_PASSWORD: 'right-password' }, async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@oraclestreet.local', password: 'wrong-password' })
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_credentials');
  });
});

test('logout clears the session cookie', async () => {
  const res = await request('/api/auth/logout', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});

test('dashboard route requires an admin session', async () => {
  const res = await request('/api/dashboard');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('dashboard route returns protected safe-test summary for admin session', async () => {
  resetAuditLogForTests();
  resetContactsForTests();
  resetSendQueueForTests();
  resetSuppressionsForTests();
  resetEmailEventsForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable'
  }, async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'correct-horse-battery-staple' })
    });
    const dashboard = await request('/api/dashboard', {
      headers: { cookie: login.headers.get('set-cookie') }
    });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.user.email, 'admin@example.test');
    assert.equal(dashboard.body.summary.emailProvider, 'dry-run');
    assert.equal(dashboard.body.summary.sendMode, 'safe-test-only');
    assert.equal(dashboard.body.summary.contacts, 0);
    assert.equal(dashboard.body.summary.queuedSends, 0);
    assert.equal(dashboard.body.emailReporting.mode, 'safe-reporting');
    assert.equal(dashboard.body.safetyGates.realSendingAllowed, false);
  });
});

test('unknown route returns JSON 404', async () => {
  const res = await request('/missing');
  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'not_found');
});


test('email config endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/email/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'dry-run');
});

test('auth endpoints also work behind nginx stripped api prefix', async () => {
  const res = await request('/auth/session');
  assert.equal(res.status, 200);
  assert.equal(res.body.authenticated, false);
});

test('dashboard endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/dashboard');
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'unauthorized');
});

const loginAsAdmin = async () => request('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.test', password: 'correct-horse-battery-staple' })
});

const withAdminEnv = async (fn) => withEnv({
  ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
  ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
  ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable'
}, fn);

test('migration manifest is protected and lists initial PostgreSQL schema', async () => {
  await withAdminEnv(async () => {
    const unauth = await request('/api/schema/migrations');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const res = await request('/api/schema/migrations', {
      headers: { cookie: login.headers.get('set-cookie') }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.migrations[0].id, '001_initial_schema');
    assert.match(res.body.migrations[0].description, /PostgreSQL schema/);
    assert.ok(res.body.migrations[0].statements >= 10);
  });
});

test('database status is protected and redacts PostgreSQL URL secrets', async () => {
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATABASE_URL: 'postgresql://app_user:super-secret@db.example.test:5433/oraclestreet?sslmode=require'
  }, async () => {
    const unauth = await request('/api/database/status');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const res = await request('/api/database/status', { headers: { cookie: login.headers.get('set-cookie') } });
    assert.equal(res.status, 200);
    assert.equal(res.body.database.ok, true);
    assert.equal(res.body.database.config.parsed.host, 'db.example.test');
    assert.equal(res.body.database.config.parsed.port, 5433);
    assert.equal(res.body.database.config.parsed.database, 'oraclestreet');
    assert.equal(res.body.database.config.parsed.passwordConfigured, true);
    assert.equal(res.body.database.connectionProbe, 'skipped_until_pg_driver_enabled');
    assert.equal(JSON.stringify(res.body).includes('super-secret'), false);
  });
});

test('database status endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/database/status');
  assert.equal(res.status, 401);
});

test('audit log requires admin session and records safe admin actions', async () => {
  resetAuditLogForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/audit-log');
    assert.equal(unauth.status, 401);

    const rejected = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'wrong-password' })
    });
    assert.equal(rejected.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    await request('/api/email/provider/validate', { method: 'POST', headers: { cookie } });
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.equal(audit.status, 200);
    assert.ok(audit.body.count >= 3);
    assert.ok(audit.body.events.some((event) => event.action === 'admin_login' && event.status === 'rejected'));
    assert.ok(audit.body.events.some((event) => event.action === 'email_provider_validate'));
    assert.equal(JSON.stringify(audit.body).includes('wrong-password'), false);
  });
});

test('audit log endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/audit-log');
  assert.equal(res.status, 401);
});

test('contact import validation requires admin session', async () => {
  const res = await request('/api/contacts/import/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contacts: [] })
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('contact list and import require admin session', async () => {
  const list = await request('/api/contacts');
  assert.equal(list.status, 401);
  const imported = await request('/api/contacts/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contacts: [] })
  });
  assert.equal(imported.status, 401);
});

test('contact import stores valid consented contacts and updates dashboard count', async () => {
  resetAuditLogForTests();
  resetContactsForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const imported = await request('/api/contacts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contacts: [
        { email: 'Person@Example.test', consentStatus: 'opt_in', source: 'owned signup form', firstName: 'Pat' },
        { email: 'two@example.test', consentStatus: 'double_opt_in', source: 'owned controlled import' }
      ] })
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.mode, 'in-memory-contact-import');
    assert.equal(imported.body.importedCount, 2);
    assert.equal(imported.body.persistenceMode, 'in-memory-until-postgresql-connection-enabled');

    const list = await request('/api/contacts', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 2);
    assert.equal(list.body.contacts[0].email, 'person@example.test');

    const dashboard = await request('/api/dashboard', { headers: { cookie } });
    assert.equal(dashboard.body.summary.contacts, 2);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'contact_import'));
  });
});

test('contact import rejects invalid rows before storing any contact', async () => {
  resetContactsForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const imported = await request('/api/contacts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contacts: [
        { email: 'bad@example.test', consentStatus: 'unknown', source: 'unknown' },
        { email: 'good@example.test', consentStatus: 'opt_in', source: 'owned controlled import' }
      ] })
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.ok, false);
    assert.equal(imported.body.mode, 'import-rejected');
    const list = await request('/api/contacts', { headers: { cookie } });
    assert.equal(list.body.count, 0);
  });
});

test('contact import validation enforces consent source and duplicate gates', async () => {
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const res = await request('/api/contacts/import/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: login.headers.get('set-cookie') },
      body: JSON.stringify({ contacts: [
        { email: 'Valid@Example.com', consentStatus: 'opt_in', source: 'owned signup form' },
        { email: 'missing-source@example.com', consentStatus: 'opt_in' },
        { email: 'bad-email', consentStatus: 'opt_in', source: 'partner import' },
        { email: 'valid@example.com', consentStatus: 'opt_in', source: 'duplicate' },
        { email: 'unknown@example.com', consentStatus: 'unknown', source: 'legacy list' }
      ] })
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.mode, 'validate-only');
    assert.equal(res.body.acceptedCount, 1);
    assert.equal(res.body.rejectedCount, 4);
    assert.equal(res.body.accepted[0].email, 'valid@example.com');
    assert.deepEqual(res.body.rejected[0].errors, ['source_required']);
    assert.ok(res.body.rejected.some((row) => row.errors.includes('duplicate_email_in_import')));
    assert.ok(res.body.rejected.some((row) => row.errors.includes('explicit_consent_required')));
  });
});

test('contact endpoints also work behind nginx stripped api prefix', async () => {
  const list = await request('/contacts');
  assert.equal(list.status, 401);
  const imported = await request('/contacts/import', { method: 'POST' });
  assert.equal(imported.status, 401);
  const validate = await request('/contacts/import/validate', { method: 'POST' });
  assert.equal(validate.status, 401);
});


test('email test-send requires admin session', async () => {
  const res = await request('/api/email/test-send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 401);
});

test('email test-send dry-runs compliant controlled message for admin', async () => {
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const res = await request('/api/email/test-send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: login.headers.get('set-cookie') },
      body: JSON.stringify({
        to: 'owned-inbox@example.test',
        subject: 'OracleStreet controlled sending test',
        html: '<p>Controlled test.</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.mode, 'dry-run');
    assert.equal(res.body.realDelivery, false);
  });
});

test('email test-send endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/email/test-send', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('email provider validation requires admin session', async () => {
  const res = await request('/api/email/provider/validate', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('email provider validation accepts dry-run without network delivery', async () => {
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const res = await request('/api/email/provider/validate', {
      method: 'POST',
      headers: { cookie: login.headers.get('set-cookie') }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.validation.ok, true);
    assert.equal(res.body.validation.provider, 'dry-run');
    assert.equal(res.body.validation.checks.networkProbe, 'not_applicable');
    assert.equal(res.body.safeDefault, 'network_probe_skipped_no_delivery');
  });
});

test('PowerMTA provider validation checks required config without exposing secrets or sending', async () => {
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_MAIL_PROVIDER: 'powermta',
    ORACLESTREET_POWERMTA_HOST: 'pmta.example.test',
    ORACLESTREET_POWERMTA_PORT: '2525',
    ORACLESTREET_POWERMTA_USERNAME: 'pmta-user',
    ORACLESTREET_POWERMTA_PASSWORD: 'pmta-secret',
    ORACLESTREET_POWERMTA_SECURE: 'false',
    ORACLESTREET_DEFAULT_FROM_EMAIL: 'sender@example.test'
  }, async () => {
    const login = await loginAsAdmin();
    const res = await request('/api/email/provider/validate', {
      method: 'POST',
      headers: { cookie: login.headers.get('set-cookie') }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.validation.ok, true);
    assert.equal(res.body.validation.provider, 'powermta');
    assert.equal(res.body.validation.checks.hostConfigured, true);
    assert.equal(res.body.validation.checks.authConfigured, true);
    assert.equal(res.body.validation.checks.networkProbe, 'skipped_safe_default');
    assert.equal(JSON.stringify(res.body).includes('pmta-secret'), false);
  });
});

test('SMTP provider validation rejects missing safe sender config', async () => {
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_MAIL_PROVIDER: 'smtp',
    ORACLESTREET_SMTP_HOST: 'smtp.example.test',
    ORACLESTREET_SMTP_USERNAME: 'smtp-user',
    ORACLESTREET_SMTP_PASSWORD: 'smtp-secret',
    ORACLESTREET_DEFAULT_FROM_EMAIL: undefined
  }, async () => {
    const login = await loginAsAdmin();
    const res = await request('/api/email/provider/validate', {
      method: 'POST',
      headers: { cookie: login.headers.get('set-cookie') }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.validation.ok, false);
    assert.ok(res.body.validation.errors.includes('valid_default_from_email_required'));
  });
});

test('email provider validation endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/email/provider/validate', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('send queue requires admin session', async () => {
  const list = await request('/api/send-queue');
  assert.equal(list.status, 401);
  const enqueue = await request('/api/send-queue/enqueue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(enqueue.status, 401);
});

test('send queue enqueues only compliant dry-run messages without delivery', async () => {
  resetSendQueueForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const rejected = await request('/api/send-queue/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ to: 'owned@example.test', subject: 'Missing gates', html: '<p>Hello</p>' })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('explicit_consent_required'));
    assert.ok(rejected.body.errors.includes('unsubscribe_link_required'));

    const enqueued = await request('/api/send-queue/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'Owned-Inbox@Example.test',
        subject: 'OracleStreet queue smoke',
        html: '<p>Controlled queue test.</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(enqueued.status, 200);
    assert.equal(enqueued.body.ok, true);
    assert.equal(enqueued.body.realDelivery, false);
    assert.equal(enqueued.body.job.status, 'queued_dry_run');
    assert.equal(enqueued.body.job.to, 'owned-inbox@example.test');
    assert.equal(enqueued.body.job.safety.consentChecked, true);
    assert.equal(enqueued.body.job.safety.realDelivery, false);

    const list = await request('/api/send-queue', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);
    assert.equal(list.body.jobs[0].id, enqueued.body.job.id);
  });
});

test('send queue endpoints also work behind nginx stripped api prefix', async () => {
  const res = await request('/send-queue/enqueue', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('suppressions require admin session and block dry-run queue recipients', async () => {
  resetSendQueueForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/suppressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'blocked@example.test', reason: 'manual', source: 'test' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const suppression = await request('/api/suppressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'Blocked@Example.test', reason: 'manual', source: 'admin smoke' })
    });
    assert.equal(suppression.status, 200);
    assert.equal(suppression.body.suppression.email, 'blocked@example.test');

    const enqueued = await request('/api/send-queue/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'blocked@example.test',
        subject: 'Should be blocked',
        html: '<p>Controlled queue test.</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(enqueued.status, 400);
    assert.ok(enqueued.body.errors.includes('recipient_suppressed'));
    assert.equal(enqueued.body.suppression.reason, 'manual');

    const list = await request('/api/suppressions', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);
  });
});

test('unsubscribe endpoint records suppression without admin session', async () => {
  resetSuppressionsForTests();
  const res = await request('/api/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'Reader@Example.test', source: 'link smoke' })
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.suppression.email, 'reader@example.test');
  assert.equal(res.body.suppression.reason, 'unsubscribe');
});

test('suppression and unsubscribe endpoints also work behind nginx stripped api prefix', async () => {
  const suppressions = await request('/suppressions');
  assert.equal(suppressions.status, 401);
  const unsubscribe = await request('/unsubscribe', { method: 'POST', body: JSON.stringify({ email: 'bad' }) });
  assert.equal(unsubscribe.status, 400);
});

test('rate-limit config requires admin session', async () => {
  const res = await request('/api/email/rate-limits');
  assert.equal(res.status, 401);
});

test('dry-run queue enforces per-domain warmup rate limit', async () => {
  resetSendQueueForTests();
  resetSuppressionsForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DRY_RUN_DOMAIN_RATE_LIMIT: '1',
    ORACLESTREET_DRY_RUN_GLOBAL_RATE_LIMIT: '5'
  }, async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const first = await request('/api/send-queue/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'first@example.test',
        subject: 'first',
        html: '<p>dry run</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.job.safety.rateLimitChecked, true);
    assert.equal(first.body.job.safety.rateLimit.domain, 'example.test');

    const second = await request('/api/send-queue/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'second@example.test',
        subject: 'second',
        html: '<p>dry run</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(second.status, 400);
    assert.ok(second.body.errors.includes('domain_rate_limit_exceeded'));
    assert.equal(second.body.rateLimit.usage.domain, 1);

    const config = await request('/api/email/rate-limits', { headers: { cookie } });
    assert.equal(config.status, 200);
    assert.equal(config.body.rateLimits.perDomainPerWindow, 1);
  });
});

test('rate-limit endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/email/rate-limits');
  assert.equal(res.status, 401);
});

test('email event ingest requires admin session', async () => {
  const res = await request('/api/email/events/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events: [] })
  });
  assert.equal(res.status, 401);
});

test('manual bounce and complaint ingest records events and suppresses recipients', async () => {
  resetSendQueueForTests();
  resetSuppressionsForTests();
  resetEmailEventsForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const ingest = await request('/api/email/events/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: [
        { type: 'bounce', email: 'Bounced@Example.test', source: 'pmta csv smoke', detail: '550 mailbox unavailable' },
        { type: 'complaint', email: 'complaint@example.test', source: 'manual abuse inbox' },
        { type: 'open', email: 'not-allowed@example.test', source: 'tracking pixel' }
      ] })
    });
    assert.equal(ingest.status, 200);
    assert.equal(ingest.body.ok, false);
    assert.equal(ingest.body.acceptedCount, 2);
    assert.equal(ingest.body.rejectedCount, 1);
    assert.equal(ingest.body.accepted[0].event.email, 'bounced@example.test');
    assert.equal(ingest.body.accepted[0].suppression.reason, 'bounce');
    assert.ok(ingest.body.rejected[0].errors.includes('valid_event_type_required'));

    const events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.status, 200);
    assert.equal(events.body.count, 2);

    const blocked = await request('/api/send-queue/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'bounced@example.test',
        subject: 'Should be blocked',
        html: '<p>dry run</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(blocked.status, 400);
    assert.ok(blocked.body.errors.includes('recipient_suppressed'));
    assert.equal(blocked.body.suppression.reason, 'bounce');
  });
});

test('email event endpoints also work behind nginx stripped api prefix', async () => {
  const list = await request('/email/events');
  assert.equal(list.status, 401);
  const ingest = await request('/email/events/ingest', { method: 'POST' });
  assert.equal(ingest.status, 401);
});

test('email reporting requires admin session and summarizes safe sending state', async () => {
  resetAuditLogForTests();
  resetSendQueueForTests();
  resetSuppressionsForTests();
  resetEmailEventsForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    await request('/api/send-queue/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'report@example.test',
        subject: 'Report smoke',
        html: '<p>dry run</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    await request('/api/email/events/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: [{ type: 'bounce', email: 'bounce-report@example.test', source: 'report smoke' }] })
    });

    const unauth = await request('/api/email/reporting');
    assert.equal(unauth.status, 401);

    const report = await request('/api/email/reporting', { headers: { cookie } });
    assert.equal(report.status, 200);
    assert.equal(report.body.mode, 'safe-reporting');
    assert.equal(report.body.totals.queuedDryRuns, 1);
    assert.equal(report.body.totals.bounces, 1);
    assert.equal(report.body.totals.suppressions, 1);
    assert.ok(report.body.totals.auditEvents >= 3);
    assert.equal(report.body.safety.realDeliveryAllowed, false);
    assert.equal(report.body.safety.complianceGates.rateLimits, 'dry_run_warmup_enforced');

    const dashboard = await request('/api/dashboard', { headers: { cookie } });
    assert.equal(dashboard.body.summary.queuedSends, 1);
    assert.equal(dashboard.body.summary.bounces, 1);
  });
});

test('email reporting endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/email/reporting');
  assert.equal(res.status, 401);
});
