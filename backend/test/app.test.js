import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { createHandler } from '../app.js';
import { resetAuditLogForTests } from '../lib/auditLog.js';
import { resetControlledLiveTestProofAuditsForTests } from '../lib/controlledLiveTestReadiness.js';
import { resetCampaignsForTests } from '../lib/campaigns.js';
import { resetContactsForTests } from '../lib/contacts.js';
import { validateDatabaseConfig } from '../lib/database.js';
import { resetDataSourcesForTests } from '../lib/dataSources.js';
import { resetEmailEventsForTests } from '../lib/emailEvents.js';
import { resetLocalCaptureForTests } from '../lib/emailProvider.js';
import { resetReputationControlsForTests } from '../lib/reputationControls.js';
import { resetSegmentsForTests } from '../lib/segments.js';
import { resetSendQueueForTests } from '../lib/sendQueue.js';
import { resetSuppressionsForTests } from '../lib/suppressions.js';
import { resetTemplatesForTests } from '../lib/templates.js';
import { resetWarmupPoliciesForTests } from '../lib/warmupPolicies.js';

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
  resetCampaignsForTests();
  resetContactsForTests();
  resetSegmentsForTests();
  resetSendQueueForTests();
  resetSuppressionsForTests();
  resetEmailEventsForTests();
  resetTemplatesForTests();
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
    assert.equal(dashboard.body.summary.segments, 0);
    assert.equal(dashboard.body.summary.templates, 0);
    assert.equal(dashboard.body.summary.campaigns, 0);
    assert.equal(dashboard.body.summary.dataSources, 0);
    assert.equal(dashboard.body.summary.dataSourceSyncRuns, 0);
    assert.equal(dashboard.body.summary.queuedSends, 0);
    assert.equal(dashboard.body.summary.opens, 0);
    assert.equal(dashboard.body.summary.clicks, 0);
    assert.equal(dashboard.body.summary.campaignOpenRate, 0);
    assert.equal(dashboard.body.summary.campaignClickRate, 0);
    assert.equal(dashboard.body.emailReporting.mode, 'safe-reporting');
    assert.equal(dashboard.body.campaignReporting.mode, 'campaign-reporting-safe-summary');
    assert.equal(dashboard.body.dataSourceReporting.mode, 'data-source-mapping-ui-safe-baseline');
    assert.equal(dashboard.body.dataSourceReporting.mappingUi, 'safe-validation-only');
    assert.equal(dashboard.body.listHygiene.mode, 'list-hygiene-cleanup-planner');
    assert.equal(dashboard.body.listHygiene.cleanupMutation, false);
    assert.equal(dashboard.body.listHygiene.realDeliveryAllowed, false);
    assert.equal(dashboard.body.dataSourceReporting.realSync, false);
    assert.equal(dashboard.body.safetyGates.engagementTracking, 'dry-run-events-only');
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

test('frontend exposes visible admin CMS workbench surfaces', () => {
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  assert.match(html, /Admin CMS workbench/);
  assert.match(html, /contacts-screen/);
  assert.match(html, /contact-import-screen/);
  assert.match(html, /api\/contacts\/import/);
  assert.match(html, /mode === 'validate' \? '\/validate'/);
  assert.match(html, /Validate contacts/);
  assert.match(html, /Import valid batch/);
  assert.match(html, /api\/list-hygiene\/plan/);
  assert.match(html, /Cleanup planner/);
  assert.match(html, /Source quality/);
  assert.match(html, /templates-screen/);
  assert.match(html, /template-create-screen/);
  assert.match(html, /api\/templates/);
  assert.match(html, /api\/templates\/preview/);
  assert.match(html, /Create safe template/);
  assert.match(html, /campaigns-screen/);
  assert.match(html, /campaign-builder-screen/);
  assert.match(html, /api\/campaigns\/estimate/);
  assert.match(html, /api\/campaigns\/approve-dry-run/);
  assert.match(html, /api\/campaigns\/schedule-dry-run/);
  assert.match(html, /api\/campaigns\/enqueue-dry-run/);
  assert.match(html, /Estimate audience/);
  assert.match(html, /Enqueue dry-run/);
  assert.match(html, /send-queue-screen/);
  assert.match(html, /api\/send-queue\/dispatch-next-dry-run/);
  assert.match(html, /Dispatch next dry-run job/);
  assert.match(html, /suppressions-screen/);
  assert.match(html, /api\/suppressions/);
  assert.match(html, /Add suppression gate/);
  assert.match(html, /suppression-reason/);
  assert.match(html, /remote-db-screen/);
  assert.match(html, /api\/data-sources/);
  assert.match(html, /Register PostgreSQL source/);
  assert.match(html, /remote-source-password/);
  assert.match(html, /api\/data-source-schema\/plan/);
  assert.match(html, /Plan schema discovery/);
  assert.match(html, /api\/data-source-query\/validate/);
  assert.match(html, /Validate SELECT query/);
  assert.match(html, /reputation-screen/);
  assert.match(html, /api\/email\/warmup\/plan/);
  assert.match(html, /Plan warm-up preview/);
  assert.match(html, /warmup-domain/);
  assert.match(html, /api\/database\/repositories/);
  assert.match(html, /PostgreSQL repository migration/);
  assert.match(html, /repository schemas/);
  assert.match(html, /api\/email\/warmup\/policy/);
  assert.match(html, /api\/email\/warmup\/schedule-cap/);
  assert.match(html, /Save warm-up policy/);
  assert.match(html, /Check schedule cap/);
  assert.match(html, /api\/email\/reputation\/policy/);
  assert.match(html, /api\/email\/reputation\/auto-pause/);
  assert.match(html, /Save auto-pause thresholds/);
  assert.match(html, /Evaluate auto-pause/);
  assert.match(html, /reporting-screen/);
  assert.match(html, /api\/email\/reporting\/export/);
  assert.match(html, /Build CSV export/);
  assert.match(html, /reporting-export-dataset/);
  assert.match(html, /audit-screen/);
  assert.match(html, /loadWorkbench/);
  assert.match(html, /api\/email\/sending-readiness/);
});

test('migration manifest is protected and lists initial PostgreSQL schema plus email engine alignment and provider traceability', async () => {
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
    const emailEngineMigration = res.body.migrations.find((migration) => migration.id === '002_email_engine_alignment');
    assert.ok(emailEngineMigration);
    assert.match(emailEngineMigration.description, /dry-run email engine safety gates/);
    assert.ok(emailEngineMigration.statements >= 8);
    const providerTraceabilityMigration = res.body.migrations.find((migration) => migration.id === '003_provider_message_event_traceability');
    assert.ok(providerTraceabilityMigration);
    assert.match(providerTraceabilityMigration.description, /provider-message traceability/);
    assert.ok(providerTraceabilityMigration.statements >= 3);
    const policyRepositoryMigration = res.body.migrations.find((migration) => migration.id === '004_policy_repository_foundation');
    assert.ok(policyRepositoryMigration);
    assert.match(policyRepositoryMigration.description, /policy repository foundation/);
    assert.ok(policyRepositoryMigration.statements >= 7);
    const campaignRepositoryMigration = res.body.migrations.find((migration) => migration.id === '005_campaign_repository_runtime_ids');
    assert.ok(campaignRepositoryMigration);
    assert.match(campaignRepositoryMigration.description, /campaign repository IDs/);
    assert.ok(campaignRepositoryMigration.statements >= 7);
    const sendQueueEventMigration = res.body.migrations.find((migration) => migration.id === '006_send_queue_event_runtime_ids');
    assert.ok(sendQueueEventMigration);
    assert.match(sendQueueEventMigration.description, /send queue and email event IDs/);
    assert.ok(sendQueueEventMigration.statements >= 10);
    const userSessionAuditMigration = res.body.migrations.find((migration) => migration.id === '007_users_sessions_audit_runtime');
    assert.ok(userSessionAuditMigration);
    assert.match(userSessionAuditMigration.description, /users, admin sessions, and audit runtime/);
    assert.ok(userSessionAuditMigration.statements >= 5);
    const policyRuntimeMigration = res.body.migrations.find((migration) => migration.id === '008_policy_runtime_status');
    assert.ok(policyRuntimeMigration);
    assert.match(policyRuntimeMigration.description, /warm-up and reputation policies/);
    assert.ok(policyRuntimeMigration.statements >= 1);
  });
});

test('database repository readiness is protected and exposes PostgreSQL schema migration plan without secrets', async () => {
  resetAuditLogForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/database/repositories');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const res = await request('/api/database/repositories', { headers: { cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'postgresql-repository-readiness');
    assert.equal(res.body.migration, '004_policy_repository_foundation');
    assert.equal(res.body.schemaFoundationReady, true);
    assert.equal(res.body.liveRepositoryEnabled, false);
    assert.equal(res.body.realDeliveryAllowed, false);
    assert.ok(res.body.modules.some((module) => module.module === 'warmup_policies' && module.targetTable === 'warmup_policies'));
    assert.ok(res.body.modules.some((module) => module.module === 'contacts' && module.nextAction === 'wire_contact_repository_to_postgresql_driver'));
    assert.ok(res.body.blockers.includes('avoid_printing_or_logging_database_url'));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'database_repository_readiness_view'));
  });
});

test('database repository readiness reports enabled CMS repositories from env without exposing secrets', async () => {
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_PG_REPOSITORIES: 'contacts,suppressions,templates,campaigns,send_queue,email_events,users,admin_sessions,audit_log,warmup_policies,reputation_policies',
    ORACLESTREET_DATABASE_URL: 'postgresql://oraclestreet_app:super-secret@127.0.0.1:5432/oraclestreet?sslmode=disable'
  }, async () => {
    const login = await loginAsAdmin();
    const res = await request('/api/database/repositories', { headers: { cookie: login.headers.get('set-cookie') } });
    assert.equal(res.status, 200);
    assert.equal(res.body.liveRepositoryEnabled, true);
    assert.equal(res.body.currentRuntimePersistence, 'partial-postgresql-runtime-repositories');
    assert.equal(res.body.summary.liveRepositoryModules, 11);
    assert.equal(res.body.summary.psqlAdapterReady, true);
    assert.ok(res.body.modules.some((module) => module.module === 'contacts' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'suppressions' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'templates' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'campaigns' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'send_queue' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'email_events' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'users' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'admin_sessions' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'audit_log' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'warmup_policies' && module.liveRepositoryEnabled));
    assert.ok(res.body.modules.some((module) => module.module === 'reputation_policies' && module.liveRepositoryEnabled));
    assert.doesNotMatch(JSON.stringify(res.body), /super-secret/);
  });
});

test('database repository readiness endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/database/repositories');
  assert.equal(res.status, 401);
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

test('data source registry requires admin and stores redacted PostgreSQL source metadata only', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withAdminEnv(async () => {
    const unauthList = await request('/api/data-sources');
    assert.equal(unauthList.status, 401);
    const unauthCreate = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Warehouse', connectionUrl: 'postgresql://reader:secret@db.example.test:5432/warehouse' })
    });
    assert.equal(unauthCreate.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const rejected = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Bad source', type: 'mysql', connectionUrl: 'mysql://reader:secret@db.example.test/app' })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('postgresql_source_type_required'));
    assert.ok(rejected.body.errors.includes('postgres_protocol_required'));
    assert.equal(JSON.stringify(rejected.body).includes('reader:secret'), false);

    const created = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Affiliate warehouse', type: 'postgresql', connectionUrl: 'postgresql://reader:source-secret@warehouse.example.test:5433/affiliate?sslmode=require' })
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.mode, 'data-source-registry-safe-baseline');
    assert.equal(created.body.source.status, 'registered_safe');
    assert.equal(created.body.source.syncEnabled, false);
    assert.equal(created.body.realSync, false);
    assert.equal(created.body.source.connection.parsed.host, 'warehouse.example.test');
    assert.equal(created.body.source.connection.parsed.port, 5433);
    assert.equal(created.body.source.connection.parsed.database, 'affiliate');
    assert.equal(created.body.source.connection.parsed.passwordConfigured, true);
    assert.equal(created.body.source.connection.secretStored, false);
    assert.equal(created.body.source.connection.connectionProbe, 'skipped_registry_validation_only');
    assert.equal(JSON.stringify(created.body).includes('source-secret'), false);

    const list = await request('/api/data-sources', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);
    assert.equal(list.body.sources[0].name, 'Affiliate warehouse');
    assert.equal(list.body.realSync, false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_create'));
    assert.ok(audit.body.events.some((event) => event.action === 'data_sources_list'));
  });
});

test('data source registry can store encrypted PostgreSQL connection secrets without exposing plaintext', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATA_SOURCE_SECRET_KEY: 'test-data-source-secret-key-at-least-32-chars'
  }, async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const created = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Encrypted warehouse',
        type: 'postgresql',
        storeSecret: true,
        connectionUrl: 'postgresql://reader:very-secret-source-password@warehouse.example.test:5432/affiliate?sslmode=require'
      })
    });

    assert.equal(created.status, 200);
    assert.equal(created.body.source.connection.secretStored, true);
    assert.equal(created.body.source.connection.secretStorage, 'encrypted-secret-baseline');
    assert.equal(created.body.source.connection.encryptedConnectionRef.algorithm, 'aes-256-gcm');
    assert.equal(created.body.source.connection.encryptedConnectionRef.ciphertextStored, true);
    assert.equal(created.body.source.connection.encryptedConnectionRef.plaintextReturned, false);
    assert.equal(created.body.source.connection.encryption.keySource, 'ORACLESTREET_DATA_SOURCE_SECRET_KEY');
    assert.equal(JSON.stringify(created.body).includes('very-secret-source-password'), false);

    const list = await request('/api/data-sources', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.sources[0].connection.secretStored, true);
    assert.equal(JSON.stringify(list.body).includes('very-secret-source-password'), false);
  });
});

test('data source encrypted secret storage requires a configured encryption key', async () => {
  resetDataSourcesForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const res = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: login.headers.get('set-cookie') },
      body: JSON.stringify({
        name: 'Needs key',
        type: 'postgresql',
        storeSecret: true,
        connectionUrl: 'postgresql://reader:secret@warehouse.example.test:5432/affiliate'
      })
    });

    assert.equal(res.status, 400);
    assert.ok(res.body.errors.includes('data_source_secret_key_required'));
    assert.equal(JSON.stringify(res.body).includes('reader:secret'), false);
  });
});

test('data source sync dry-run requires admin and validates registered sources without pulling rows', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATA_SOURCE_SECRET_KEY: 'test-data-source-secret-key-at-least-32-chars'
  }, async () => {
    const unauth = await request('/api/data-source-sync-runs', { method: 'POST', body: JSON.stringify({ dataSourceId: 'ds_missing' }) });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const missing = await request('/api/data-source-sync-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: 'ds_missing' })
    });
    assert.equal(missing.status, 400);
    assert.ok(missing.body.errors.includes('data_source_not_found'));
    assert.equal(missing.body.rowsPulled, 0);
    assert.equal(missing.body.networkProbe, 'skipped');

    const created = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Sync warehouse',
        type: 'postgresql',
        storeSecret: true,
        connectionUrl: 'postgresql://reader:sync-secret@warehouse.example.test:5432/affiliate?sslmode=require'
      })
    });
    const sync = await request('/api/data-source-sync-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: created.body.source.id, mapping: { fields: ['email', 'source', 'consent_status'] } })
    });

    assert.equal(sync.status, 200);
    assert.equal(sync.body.run.mode, 'data-source-sync-dry-run-baseline');
    assert.equal(sync.body.run.status, 'validated_dry_run');
    assert.equal(sync.body.run.rowsSeen, 0);
    assert.equal(sync.body.run.rowsImported, 0);
    assert.equal(sync.body.run.rowsPulled, 0);
    assert.equal(sync.body.run.realSync, false);
    assert.equal(sync.body.run.networkProbe, 'skipped');
    assert.equal(sync.body.run.mapping.status, 'provided_for_validation_only');
    assert.ok(sync.body.run.validation.requiredGates.includes('no_remote_rows_pulled'));
    assert.ok(sync.body.run.validation.blockers.includes('sync_disabled_until_mapping_and_import_gates_exist'));
    assert.equal(JSON.stringify(sync.body).includes('sync-secret'), false);

    const list = await request('/api/data-source-sync-runs', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);
    assert.equal(list.body.runs[0].dataSourceName, 'Sync warehouse');
    assert.equal(list.body.realSync, false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_sync_dry_run'));
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_sync_runs_list'));
  });
});

test('remote PostgreSQL import scheduler plans recurring imports without pulling rows or exposing secrets', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATA_SOURCE_SECRET_KEY: 'test-data-source-secret-key-at-least-32-chars'
  }, async () => {
    const unauth = await request('/api/data-source-import-schedules', { method: 'POST', body: JSON.stringify({ dataSourceId: 'ds_missing' }) });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const created = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Schedule warehouse',
        type: 'postgresql',
        storeSecret: true,
        connectionUrl: 'postgresql://reader:schedule-secret@warehouse.example.test:5432/affiliate?sslmode=require'
      })
    });

    const rejected = await request('/api/data-source-import-schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        dataSourceId: created.body.source.id,
        sql: 'update contacts set email = email',
        mapping: { emailColumn: 'email', defaults: { consentStatus: 'opt_in', source: 'remote-schedule' } },
        intervalHours: 0,
        enabled: true
      })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('valid_interval_hours_1_720_required'));
    assert.ok(rejected.body.errors.includes('select_only_sql_required'));
    assert.ok(rejected.body.errors.includes('destructive_sql_rejected'));
    assert.ok(rejected.body.errors.includes('exact_remote_import_schedule_approval_phrase_required'));
    assert.equal(rejected.body.scheduleMutation, false);
    assert.equal(rejected.body.realSync, false);
    assert.equal(rejected.body.automaticPulls, false);
    assert.equal(JSON.stringify(rejected.body).includes('schedule-secret'), false);

    const planned = await request('/api/data-source-import-schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        dataSourceId: created.body.source.id,
        sql: 'select email, consent_status, source, first_name from contacts',
        limit: 50,
        timeoutMs: 3000,
        intervalHours: 12,
        enabled: true,
        approvalPhrase: 'I_APPROVE_REMOTE_POSTGRESQL_IMPORT_SCHEDULE_PLAN',
        mapping: {
          emailColumn: 'email',
          consentStatusColumn: 'consent_status',
          sourceColumn: 'source',
          firstNameColumn: 'first_name',
          defaults: { consentStatus: 'opt_in', source: 'remote-schedule' }
        }
      })
    });
    assert.equal(planned.status, 200);
    assert.equal(planned.body.mode, 'data-source-import-schedule-plan');
    assert.equal(planned.body.schedule.status, 'approved_manual_schedule_plan');
    assert.equal(planned.body.schedule.enabled, true);
    assert.equal(planned.body.schedule.intervalHours, 12);
    assert.equal(planned.body.schedule.query.selectOnly, true);
    assert.match(planned.body.schedule.query.projectedSql, /LIMIT 50$/);
    assert.equal(planned.body.schedule.mapping.emailColumn, 'email');
    assert.equal(planned.body.schedule.safety.noImmediateRemotePull, true);
    assert.equal(planned.body.schedule.safety.noAutomaticWorker, true);
    assert.equal(planned.body.schedule.safety.noContactImportMutation, true);
    assert.equal(planned.body.realSync, false);
    assert.equal(planned.body.automaticPulls, false);
    assert.equal(planned.body.realDeliveryAllowed, false);
    assert.ok(planned.body.schedule.validation.requiredGates.includes('manual_execution_only'));
    assert.ok(planned.body.schedule.validation.blockers.includes('automatic_worker_not_enabled'));
    assert.equal(JSON.stringify(planned.body).includes('schedule-secret'), false);

    const list = await request('/api/data-source-import-schedules', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);
    assert.equal(list.body.schedules[0].dataSourceName, 'Schedule warehouse');
    assert.equal(list.body.realSync, false);
    assert.equal(list.body.automaticPulls, false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_import_schedule_plan'));
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_import_schedules_list'));
  });
});

test('data source schema discovery planner requires admin and returns safe information-schema plan without probing', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATA_SOURCE_SECRET_KEY: 'test-data-source-secret-key-at-least-32-chars'
  }, async () => {
    const unauth = await request('/api/data-source-schema/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataSourceId: 'ds_missing', schemas: ['public'] })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const created = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Schema warehouse',
        type: 'postgresql',
        storeSecret: true,
        connectionUrl: 'postgresql://reader:schema-secret@warehouse.example.test:5432/affiliate?sslmode=require'
      })
    });

    const rejected = await request('/api/data-source-schema/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: created.body.source.id, schemas: ['public;drop'], tableLimit: 100 })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('valid_schema_names_required'));
    assert.equal(rejected.body.realDiscovery, false);
    assert.equal(rejected.body.tablesReturned, 0);

    const planned = await request('/api/data-source-schema/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: created.body.source.id, schemas: ['public', 'analytics'], tableLimit: 25, columnLimit: 250, timeoutMs: 3000 })
    });
    assert.equal(planned.status, 200);
    assert.equal(planned.body.mode, 'data-source-schema-discovery-safe-plan');
    assert.deepEqual(planned.body.discovery.schemas, ['public', 'analytics']);
    assert.match(planned.body.discovery.tablesSql, /information_schema\.tables/);
    assert.match(planned.body.discovery.columnsSql, /information_schema\.columns/);
    assert.equal(planned.body.tablesReturned, 0);
    assert.equal(planned.body.columnsReturned, 0);
    assert.equal(planned.body.realDiscovery, false);
    assert.equal(planned.body.networkProbe, 'skipped_until_pg_driver_and_operator_approval');
    assert.ok(planned.body.requiredGates.includes('schema_allowlist'));
    assert.equal(JSON.stringify(planned.body).includes('schema-secret'), false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_schema_plan'));
  });
});

test('data source schema planner endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/data-source-schema/plan', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 401);
});

test('data source SELECT-only query validator requires admin and rejects unsafe SQL without pulling rows', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATA_SOURCE_SECRET_KEY: 'test-data-source-secret-key-at-least-32-chars'
  }, async () => {
    const unauth = await request('/api/data-source-query/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataSourceId: 'ds_missing', sql: 'select * from contacts' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const created = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Query warehouse',
        type: 'postgresql',
        storeSecret: true,
        connectionUrl: 'postgresql://reader:query-secret@warehouse.example.test:5432/affiliate?sslmode=require'
      })
    });

    const rejected = await request('/api/data-source-query/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: created.body.source.id, sql: 'delete from contacts', limit: 100, timeoutMs: 5000 })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('select_only_sql_required'));
    assert.ok(rejected.body.errors.includes('destructive_sql_rejected'));
    assert.equal(rejected.body.realQuery, false);
    assert.equal(rejected.body.rowsReturned, 0);

    const planned = await request('/api/data-source-query/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: created.body.source.id, sql: 'select email, source from contacts', limit: 50, timeoutMs: 2500 })
    });
    assert.equal(planned.status, 200);
    assert.equal(planned.body.mode, 'data-source-select-query-safe-plan');
    assert.equal(planned.body.query.selectOnly, true);
    assert.equal(planned.body.query.projectedSql, 'select email, source from contacts LIMIT 50');
    assert.equal(planned.body.rowsPulled, 0);
    assert.equal(planned.body.realQuery, false);
    assert.equal(planned.body.networkProbe, 'skipped_until_pg_driver_and_operator_approval');
    assert.ok(planned.body.requiredGates.includes('select_only_sql'));
    assert.equal(JSON.stringify(planned.body).includes('query-secret'), false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_query_validate'));
  });
});

test('data source query validator endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/data-source-query/validate', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 401);
});

test('live remote PostgreSQL query and schema execution stay gated and redacted', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATA_SOURCE_SECRET_KEY: 'test-data-source-secret-key-at-least-32-chars',
    ORACLESTREET_REMOTE_PG_EXECUTION_ENABLED: 'false'
  }, async () => {
    const unauth = await request('/api/data-source-query/execute', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const created = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Live gated warehouse',
        type: 'postgresql',
        storeSecret: true,
        connectionUrl: 'postgresql://reader:live-secret@warehouse.example.test:5432/affiliate?sslmode=require'
      })
    });

    const blockedQuery = await request('/api/data-source-query/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: created.body.source.id, sql: 'select email from contacts', limit: 25, timeoutMs: 500, approvalPhrase: 'wrong' })
    });
    assert.equal(blockedQuery.status, 400);
    assert.equal(blockedQuery.body.mode, 'data-source-select-query-live-gate');
    assert.ok(blockedQuery.body.errors.includes('remote_postgresql_execution_disabled'));
    assert.ok(blockedQuery.body.errors.includes('exact_remote_read_only_approval_phrase_required'));
    assert.equal(blockedQuery.body.realQuery, false);
    assert.equal(blockedQuery.body.rowsPulled, 0);
    assert.equal(blockedQuery.body.safety.noSecretOutput, true);
    assert.equal(JSON.stringify(blockedQuery.body).includes('live-secret'), false);

    const blockedSchema = await request('/api/data-source-schema/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: created.body.source.id, schemas: ['public'], tableLimit: 10, columnLimit: 50, timeoutMs: 500, approvalPhrase: 'I_APPROVE_REMOTE_POSTGRESQL_READ_ONLY_EXECUTION' })
    });
    assert.equal(blockedSchema.status, 400);
    assert.equal(blockedSchema.body.mode, 'data-source-schema-discovery-live-gate');
    assert.ok(blockedSchema.body.errors.includes('remote_postgresql_execution_disabled'));
    assert.equal(blockedSchema.body.realDiscovery, false);
    assert.equal(blockedSchema.body.tablesReturned, 0);
    assert.equal(JSON.stringify(blockedSchema.body).includes('live-secret'), false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_query_execute'));
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_schema_discover'));
  });
});

test('remote PostgreSQL contact import preview maps rows through contact validation without importing', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable'
  }, async () => {
    const unauth = await request('/api/data-source-import/preview', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const preview = await request('/api/data-source-import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        rows: [
          { email_address: 'Reader@Example.test', consent: 'opt_in', list_source: 'owned remote warehouse', first_name: 'Ada' },
          { email_address: 'bad-email', consent: 'opt_in', list_source: 'owned remote warehouse' },
          { email_address: 'reader@example.test', consent: 'opt_in', list_source: 'owned remote warehouse' }
        ],
        mapping: { email: 'email_address', consentStatus: 'consent', source: 'list_source', firstName: 'first_name' },
        defaults: { source: 'remote-postgresql-preview', consentStatus: 'opt_in' }
      })
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.mode, 'data-source-contact-import-preview');
    assert.equal(preview.body.previewOk, false);
    assert.equal(preview.body.rowsSeen, 3);
    assert.equal(preview.body.acceptedCount, 1);
    assert.equal(preview.body.rejectedCount, 2);
    assert.equal(preview.body.importMutation, false);
    assert.equal(preview.body.realQuery, false);
    assert.equal(preview.body.sampleAccepted[0].email, 'reader@example.test');
    assert.ok(preview.body.sampleRejected.some((row) => row.errors.includes('valid_email_required')));
    assert.ok(preview.body.sampleRejected.some((row) => row.errors.includes('duplicate_email_in_import')));

    const contacts = await request('/api/contacts', { headers: { cookie } });
    assert.equal(contacts.body.count, 0);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_contact_import_preview'));
  });
});

test('approved remote PostgreSQL contact import gate imports only valid preview rows and records sync history', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  resetContactsForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable'
  }, async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const payload = {
      rows: [
        { email_address: 'Reader@Example.test', consent: 'opt_in', list_source: 'owned remote warehouse', first_name: 'Ada' }
      ],
      mapping: { email: 'email_address', consentStatus: 'consent', source: 'list_source', firstName: 'first_name' },
      defaults: { source: 'remote-postgresql-preview', consentStatus: 'opt_in' }
    };

    const blocked = await request('/api/data-source-import/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ...payload, importApprovalPhrase: 'wrong' })
    });
    assert.equal(blocked.status, 400);
    assert.ok(blocked.body.errors.includes('exact_remote_contact_import_approval_phrase_required'));
    assert.equal(blocked.body.importMutation, false);

    const imported = await request('/api/data-source-import/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ...payload, importApprovalPhrase: 'I_APPROVE_REMOTE_POSTGRESQL_CONTACT_IMPORT' })
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.mode, 'data-source-contact-import-approved-gate');
    assert.equal(imported.body.importMutation, true);
    assert.equal(imported.body.importedCount, 1);
    assert.equal(imported.body.updatedCount, 0);
    assert.equal(imported.body.realDeliveryAllowed, false);
    assert.match(imported.body.syncRun.id, /^sync_/);
    assert.equal(imported.body.syncRun.rowsImported, 1);

    const contacts = await request('/api/contacts', { headers: { cookie } });
    assert.equal(contacts.body.count, 1);
    assert.equal(contacts.body.contacts[0].email, 'reader@example.test');

    const syncRuns = await request('/api/data-source-sync-runs', { headers: { cookie } });
    assert.ok(syncRuns.body.runs.some((run) => run.id === imported.body.syncRun.id && run.status === 'imported_contacts'));
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_contact_import_execute'));
  });
});

test('data source sync audit log requires admin and returns sanitized sync events only', async () => {
  resetAuditLogForTests();
  resetDataSourcesForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATA_SOURCE_SECRET_KEY: 'test-data-source-secret-key-at-least-32-chars'
  }, async () => {
    const unauth = await request('/api/data-source-sync-audit');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const created = await request('/api/data-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Audit warehouse',
        type: 'postgresql',
        storeSecret: true,
        connectionUrl: 'postgresql://reader:audit-secret@warehouse.example.test:5432/affiliate?sslmode=require'
      })
    });
    await request('/api/data-source-sync-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ dataSourceId: created.body.source.id, mapping: { fields: ['email'] } })
    });

    const audit = await request('/api/data-source-sync-audit', { headers: { cookie } });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.mode, 'data-source-sync-audit-baseline');
    assert.equal(audit.body.realSync, false);
    assert.ok(audit.body.events.length >= 1);
    assert.ok(audit.body.events.every((event) => event.action.startsWith('data_source_sync')));
    assert.ok(audit.body.events.some((event) => event.action === 'data_source_sync_dry_run'));
    assert.equal(JSON.stringify(audit.body).includes('audit-secret'), false);
  });
});

test('data source sync run endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/data-source-sync-runs');
  assert.equal(res.status, 401);
});

test('data source sync audit endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/data-source-sync-audit');
  assert.equal(res.status, 401);
});

test('data source registry endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/data-sources');
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

test('contact browser search filters and source-quality drilldowns require admin and stay read-only', async () => {
  resetAuditLogForTests();
  resetContactsForTests();
  resetSuppressionsForTests();
  resetEmailEventsForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable'
  }, async () => {
    const unauth = await request('/api/contacts/browser?search=example');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    await request('/api/contacts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contacts: [
        { email: 'Ada@Example.test', consentStatus: 'opt_in', source: 'owned newsletter', firstName: 'Ada', lastName: 'Lovelace' },
        { email: 'support@example.test', consentStatus: 'opt_in', source: 'support imports', firstName: 'Support' },
        { email: 'reader@other.test', consentStatus: 'double_opt_in', source: 'partner optin', firstName: 'Reader' }
      ] })
    });
    await request('/api/suppressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'support@example.test', reason: 'manual', source: 'test suppression' })
    });

    const search = await request('/api/contacts/browser?search=ada&domain=example.test&suppression=not_suppressed', { headers: { cookie } });
    assert.equal(search.status, 200);
    assert.equal(search.body.mode, 'contact-browser-search-filter-drilldown');
    assert.equal(search.body.totals.matchedContacts, 1);
    assert.equal(search.body.contacts[0].email, 'ada@example.test');
    assert.equal(search.body.contacts[0].suppressed, false);
    assert.equal(search.body.safety.noContactMutation, true);
    assert.equal(search.body.safety.realDeliveryAllowed, false);

    const risky = await request('/api/contacts/browser?risk=role_account', { headers: { cookie } });
    assert.equal(risky.status, 200);
    assert.ok(risky.body.contacts.some((contact) => contact.email === 'support@example.test' && contact.riskFlags.includes('role_account')));
    assert.ok(risky.body.sourceQuality.some((source) => source.source === 'support imports' && source.suppressed === 1));
    assert.ok(risky.body.domainConcentration.some((entry) => entry.domain === 'example.test'));

    const contacts = await request('/api/contacts', { headers: { cookie } });
    assert.equal(contacts.body.count, 3);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'contact_browser_search'));
  });
});

test('list hygiene cleanup planner requires admin session and returns safe read-only recommendations', async () => {
  resetAuditLogForTests();
  resetContactsForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/list-hygiene/plan');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    await request('/api/contacts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contacts: [
        { email: 'support@gmail.com', consentStatus: 'opt_in', source: 'owned signup form' },
        { email: 'reader@company.test', consentStatus: 'double_opt_in', source: 'owned signup form', sourceDetail: 'spring form' }
      ] })
    });
    await request('/api/suppressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'reader@company.test', reason: 'manual', source: 'qa-test' })
    });

    const plan = await request('/api/list-hygiene/plan?staleAfterDays=180', { headers: { cookie } });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.mode, 'list-hygiene-cleanup-planner');
    assert.equal(plan.body.cleanupMutation, false);
    assert.equal(plan.body.realDeliveryAllowed, false);
    assert.equal(plan.body.totals.contacts, 2);
    assert.equal(plan.body.totals.riskyContacts, 1);
    assert.equal(plan.body.totals.suppressedContacts, 1);
    assert.ok(plan.body.recommendations.some((item) => item.action === 'exclude_suppressed_contacts'));
    assert.ok(plan.body.recommendations.some((item) => item.action === 'review_risky_contacts'));
    assert.ok(plan.body.sourceQuality.some((source) => source.source === 'owned signup form'));
    assert.ok(plan.body.domainConcentration.some((domain) => domain.domain === 'gmail.com'));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'list_hygiene_plan_view'));
  });
});

test('contact endpoints also work behind nginx stripped api prefix', async () => {
  const list = await request('/contacts');
  assert.equal(list.status, 401);
  const imported = await request('/contacts/import', { method: 'POST' });
  assert.equal(imported.status, 401);
  const validate = await request('/contacts/import/validate', { method: 'POST' });
  assert.equal(validate.status, 401);
  const hygiene = await request('/list-hygiene/plan');
  assert.equal(hygiene.status, 401);
});

test('segment endpoints require admin session', async () => {
  const list = await request('/api/segments');
  assert.equal(list.status, 401);
  const create = await request('/api/segments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Owned', criteria: {} })
  });
  assert.equal(create.status, 401);
  const estimate = await request('/api/segments/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ criteria: {} })
  });
  assert.equal(estimate.status, 401);
});

test('segments estimate safe audiences and exclude suppressed contacts', async () => {
  resetAuditLogForTests();
  resetContactsForTests();
  resetSegmentsForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    await request('/api/contacts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contacts: [
        { email: 'a@example.test', consentStatus: 'opt_in', source: 'owned signup form' },
        { email: 'b@example.test', consentStatus: 'double_opt_in', source: 'owned signup form' },
        { email: 'c@other.test', consentStatus: 'opt_in', source: 'owned partner form' }
      ] })
    });
    await request('/api/suppressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'a@example.test', reason: 'manual', source: 'segment smoke' })
    });

    const estimate = await request('/api/segments/estimate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ criteria: { sourceIncludes: 'owned', emailDomain: 'example.test' } })
    });
    assert.equal(estimate.status, 200);
    assert.equal(estimate.body.mode, 'safe-segment-estimate');
    assert.equal(estimate.body.totalContacts, 3);
    assert.equal(estimate.body.suppressedCount, 1);
    assert.equal(estimate.body.estimatedAudience, 1);
    assert.equal(estimate.body.contacts[0].email, 'b@example.test');

    const created = await request('/api/segments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Owned example.test safe audience', criteria: { sourceIncludes: 'owned', emailDomain: 'example.test' } })
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.segment.estimatedAudience, 1);

    const list = await request('/api/segments', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);

    const dashboard = await request('/api/dashboard', { headers: { cookie } });
    assert.equal(dashboard.body.summary.segments, 1);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'segment_create'));
  });
});

test('segment endpoints also work behind nginx stripped api prefix', async () => {
  const list = await request('/segments');
  assert.equal(list.status, 401);
  const estimate = await request('/segments/estimate', { method: 'POST' });
  assert.equal(estimate.status, 401);
});

test('template endpoints require admin session', async () => {
  const list = await request('/api/templates');
  assert.equal(list.status, 401);
  const create = await request('/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Promo', subject: 'Hi', html: '<p>unsubscribe</p>' })
  });
  assert.equal(create.status, 401);
  const preview = await request('/api/templates/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'tpl_000001' })
  });
  assert.equal(preview.status, 401);
});

test('templates require unsubscribe language and render safe previews without delivery', async () => {
  resetAuditLogForTests();
  resetTemplatesForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const rejected = await request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Bad template', subject: 'Hi {{firstName}}', html: '<p>Hello</p>' })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('unsubscribe_language_required'));

    const created = await request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Compliant promo',
        subject: 'Hi {{firstName}}',
        html: '<p>Hello {{firstName}}</p><p>unsubscribe anytime</p>',
        text: 'Hello {{firstName}}\nunsubscribe anytime'
      })
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.mode, 'in-memory-template');

    const preview = await request('/api/templates/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: created.body.template.id, data: { firstName: 'Pat' } })
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.mode, 'safe-template-preview');
    assert.equal(preview.body.realDelivery, false);
    assert.equal(preview.body.rendered.subject, 'Hi Pat');
    assert.match(preview.body.rendered.html, /Hello Pat/);

    const trackedPreview = await request('/api/templates/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ id: created.body.template.id, data: { firstName: 'Pat', unsubscribeUrl: 'https://example.test/u', openTrackingUrl: 'https://example.test/open', clickTrackingUrl: 'https://example.test/click' } })
    });
    assert.equal(trackedPreview.status, 200);
    assert.ok(trackedPreview.body.rendered.html.includes('https://example.test/open'));
    assert.equal(trackedPreview.body.rendered.openTrackingInjected, true);
    assert.equal(trackedPreview.body.rendered.clickTrackingUrl, 'https://example.test/click');

    const list = await request('/api/templates', { headers: { cookie } });
    assert.equal(list.body.count, 1);

    const dashboard = await request('/api/dashboard', { headers: { cookie } });
    assert.equal(dashboard.body.summary.templates, 1);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'template_create'));
    assert.ok(audit.body.events.some((event) => event.action === 'template_preview'));
  });
});

test('template endpoints also work behind nginx stripped api prefix', async () => {
  const list = await request('/templates');
  assert.equal(list.status, 401);
  const preview = await request('/templates/preview', { method: 'POST' });
  assert.equal(preview.status, 401);
});

test('campaign endpoints require admin session', async () => {
  const list = await request('/api/campaigns');
  assert.equal(list.status, 401);
  const create = await request('/api/campaigns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Campaign', segmentId: 'seg_000001', templateId: 'tpl_000001' })
  });
  assert.equal(create.status, 401);
  const estimate = await request('/api/campaigns/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segmentId: 'seg_000001', templateId: 'tpl_000001' })
  });
  assert.equal(estimate.status, 401);
  const approve = await request('/api/campaigns/approve-dry-run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaignId: 'cmp_000001' })
  });
  assert.equal(approve.status, 401);
  const enqueue = await request('/api/campaigns/enqueue-dry-run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaignId: 'cmp_000001' })
  });
  assert.equal(enqueue.status, 401);
});

test('campaign draft baseline estimates and enqueues safe dry-run audience without delivery', async () => {
  resetAuditLogForTests();
  resetCampaignsForTests();
  resetContactsForTests();
  resetSegmentsForTests();
  resetSendQueueForTests();
  resetSuppressionsForTests();
  resetTemplatesForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    await request('/api/contacts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contacts: [
        { email: 'buyer-a@example.test', consentStatus: 'opt_in', source: 'owned campaign import' },
        { email: 'buyer-b@example.test', consentStatus: 'double_opt_in', source: 'owned campaign import' }
      ] })
    });
    await request('/api/suppressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'buyer-a@example.test', reason: 'manual', source: 'campaign smoke' })
    });
    const segment = await request('/api/segments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Campaign audience', criteria: { sourceIncludes: 'campaign', emailDomain: 'example.test' } })
    });
    const template = await request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Campaign template', subject: 'Hi {{firstName}}', html: '<p>Hello</p><p>unsubscribe anytime</p>' })
    });

    const estimate = await request('/api/campaigns/estimate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ segmentId: segment.body.segment.id, templateId: template.body.template.id })
    });
    assert.equal(estimate.status, 200);
    assert.equal(estimate.body.mode, 'safe-campaign-estimate');
    assert.equal(estimate.body.estimatedAudience, 1);
    assert.equal(estimate.body.suppressedCount, 1);
    assert.equal(estimate.body.realDelivery, false);
    assert.equal(estimate.body.compliance.suppressionsExcluded, true);
    assert.equal(estimate.body.compliance.unsubscribeLinkInjected, true);

    const campaign = await request('/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Draft campaign', segmentId: segment.body.segment.id, templateId: template.body.template.id })
    });
    assert.equal(campaign.status, 200);
    assert.equal(campaign.body.mode, 'in-memory-campaign-draft');
    assert.equal(campaign.body.campaign.status, 'draft');
    assert.equal(campaign.body.campaign.realDeliveryAllowed, false);

    const prematureEnqueue = await request('/api/campaigns/enqueue-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id })
    });
    assert.equal(prematureEnqueue.status, 400);
    assert.ok(prematureEnqueue.body.errors.includes('campaign_must_be_approved_or_scheduled_dry_run'));

    const approval = await request('/api/campaigns/approve-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id })
    });
    assert.equal(approval.status, 200);
    assert.equal(approval.body.mode, 'campaign-dry-run-approval');
    assert.equal(approval.body.campaign.status, 'approved_dry_run');
    assert.equal(approval.body.realDelivery, false);
    assert.equal(approval.body.compliance.realDeliveryAllowed, false);
    assert.equal(approval.body.compliance.unsubscribeLinkInjected, true);

    const pastSchedule = await request('/api/campaigns/schedule-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id, scheduledAt: '2020-01-01T00:00:00.000Z' })
    });
    assert.equal(pastSchedule.status, 400);
    assert.ok(pastSchedule.body.errors.includes('scheduled_at_must_be_future'));

    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await request('/api/campaigns/schedule-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id, scheduledAt })
    });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.body.mode, 'campaign-dry-run-schedule');
    assert.equal(scheduled.body.campaign.status, 'scheduled_dry_run');
    assert.equal(scheduled.body.campaign.scheduledAt, scheduledAt);
    assert.equal(scheduled.body.campaign.warmupDailyCap, 25);
    assert.equal(scheduled.body.warmupCap.capExceeded, false);
    assert.equal(scheduled.body.realDelivery, false);
    assert.equal(scheduled.body.compliance.manualDispatchRequired, true);
    assert.equal(scheduled.body.compliance.warmupCapEnforced, true);

    const enqueued = await request('/api/campaigns/enqueue-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id })
    });
    assert.equal(enqueued.status, 200);
    assert.equal(enqueued.body.mode, 'campaign-dry-run-queue');
    assert.equal(enqueued.body.enqueuedCount, 1);
    assert.equal(enqueued.body.realDelivery, false);
    assert.equal(enqueued.body.campaign.status, 'queued_dry_run');
    assert.equal(enqueued.body.jobs[0].campaignId, campaign.body.campaign.id);
    assert.equal(enqueued.body.jobs[0].to, 'buyer-b@example.test');
    assert.ok(enqueued.body.jobs[0].unsubscribeUrl.includes('/api/unsubscribe?'));
    assert.ok(enqueued.body.jobs[0].unsubscribeUrl.includes('buyer-b%40example.test'));
    assert.ok(enqueued.body.jobs[0].unsubscribeUrl.includes(campaign.body.campaign.id));
    assert.equal(enqueued.body.jobs[0].safety.unsubscribeLinkInjected, true);
    assert.ok(enqueued.body.jobs[0].openTrackingUrl.includes('/api/track/open?'));
    assert.ok(enqueued.body.jobs[0].clickTrackingUrl.includes('/api/track/click?'));
    assert.equal(enqueued.body.jobs[0].safety.openTrackingInjected, true);
    assert.equal(enqueued.body.jobs[0].safety.clickTrackingAvailable, true);

    const list = await request('/api/campaigns', { headers: { cookie } });
    assert.equal(list.body.count, 1);
    assert.equal(list.body.campaigns[0].status, 'queued_dry_run');
    const queue = await request('/api/send-queue', { headers: { cookie } });
    assert.equal(queue.body.count, 1);
    assert.equal(queue.body.jobs[0].safety.realDelivery, false);
    assert.equal(queue.body.jobs[0].safety.unsubscribeLinkInjected, true);
    assert.equal(queue.body.jobs[0].safety.openTrackingInjected, true);
    assert.equal(queue.body.jobs[0].safety.clickTrackingAvailable, true);

    const dispatched = await request('/api/send-queue/dispatch-next-dry-run', { method: 'POST', headers: { cookie } });
    assert.equal(dispatched.status, 200);
    assert.equal(dispatched.body.event.campaignId, campaign.body.campaign.id);
    assert.equal(dispatched.body.event.contactId, enqueued.body.jobs[0].contactId);

    const open = await request(enqueued.body.jobs[0].openTrackingUrl);
    assert.equal(open.status, 200);
    const click = await request(enqueued.body.jobs[0].clickTrackingUrl);
    assert.equal(click.status, 200);

    const unsubscribe = await request(enqueued.body.jobs[0].unsubscribeUrl);
    assert.equal(unsubscribe.status, 200);
    assert.equal(unsubscribe.body.campaignId, campaign.body.campaign.id);

    const campaignReport = await request('/api/campaigns/reporting', { headers: { cookie } });
    assert.equal(campaignReport.status, 200);
    assert.equal(campaignReport.body.mode, 'campaign-reporting-safe-summary');
    assert.equal(campaignReport.body.realDeliveryAllowed, false);
    assert.equal(campaignReport.body.campaigns[0].campaignId, campaign.body.campaign.id);
    assert.equal(campaignReport.body.campaigns[0].dispatchedDryRuns, 1);
    assert.equal(campaignReport.body.campaigns[0].events.dispatched, 1);
    assert.equal(campaignReport.body.campaigns[0].engagement.opens, 1);
    assert.equal(campaignReport.body.campaigns[0].engagement.clicks, 1);
    assert.equal(campaignReport.body.campaigns[0].engagement.openRate, 1);
    assert.equal(campaignReport.body.campaigns[0].engagement.clickRate, 1);
    assert.equal(campaignReport.body.campaigns[0].engagement.deliveryMode, 'dry-run-events-only');
    assert.equal(campaignReport.body.campaigns[0].unsubscribes, 1);

    const dashboard = await request('/api/dashboard', { headers: { cookie } });
    assert.equal(dashboard.body.summary.campaigns, 1);
    assert.equal(dashboard.body.summary.opens, 1);
    assert.equal(dashboard.body.summary.clicks, 1);
    assert.equal(dashboard.body.summary.campaignOpenRate, 1);
    assert.equal(dashboard.body.summary.campaignClickRate, 1);
    assert.equal(dashboard.body.campaignReporting.campaigns[0].engagement.opens, 1);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'campaign_create'));
    assert.ok(audit.body.events.some((event) => event.action === 'campaign_approve_dry_run'));
    assert.ok(audit.body.events.some((event) => event.action === 'campaign_schedule_dry_run'));
    assert.ok(audit.body.events.some((event) => event.action === 'campaign_enqueue_dry_run'));
    assert.ok(audit.body.events.some((event) => event.action === 'campaign_reporting_view'));
  });
});

test('campaign endpoints also work behind nginx stripped api prefix', async () => {
  const list = await request('/campaigns');
  assert.equal(list.status, 401);
  const estimate = await request('/campaigns/estimate', { method: 'POST' });
  assert.equal(estimate.status, 401);
  const approve = await request('/campaigns/approve-dry-run', { method: 'POST' });
  assert.equal(approve.status, 401);
  const schedule = await request('/campaigns/schedule-dry-run', { method: 'POST' });
  assert.equal(schedule.status, 401);
  const enqueue = await request('/campaigns/enqueue-dry-run', { method: 'POST' });
  assert.equal(enqueue.status, 401);
  const reporting = await request('/campaigns/reporting');
  assert.equal(reporting.status, 401);
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

test('provider adapter endpoint reports safe dispatch capability without delivery', async () => {
  resetAuditLogForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/provider/adapter');
    assert.equal(unauth.status, 401);
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const adapter = await request('/api/email/provider/adapter', { headers: { cookie } });
    assert.equal(adapter.status, 200);
    assert.equal(adapter.body.mode, 'safe-provider-adapter');
    assert.equal(adapter.body.name, 'dry-run');
    assert.equal(adapter.body.capabilities.dispatchMode, 'dry-run-only');
    assert.equal(adapter.body.canDeliverExternally, false);
    assert.equal(adapter.body.realDeliveryAllowed, false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_provider_adapter_view'));
  });
});

test('PowerMTA provider adapter remains configured-but-locked and redacts secrets', async () => {
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_MAIL_PROVIDER: 'powermta',
    ORACLESTREET_POWERMTA_HOST: 'pmta.example.test',
    ORACLESTREET_POWERMTA_PORT: '2525',
    ORACLESTREET_POWERMTA_USERNAME: 'pmta-user',
    ORACLESTREET_POWERMTA_PASSWORD: 'pmta-secret',
    ORACLESTREET_DEFAULT_FROM_EMAIL: 'sender@example.test'
  }, async () => {
    const login = await loginAsAdmin();
    const adapter = await request('/api/email/provider/adapter', { headers: { cookie: login.headers.get('set-cookie') } });
    assert.equal(adapter.status, 200);
    assert.equal(adapter.body.ok, true);
    assert.equal(adapter.body.name, 'powermta');
    assert.equal(adapter.body.capabilities.supportsSmtpTransport, true);
    assert.equal(adapter.body.capabilities.dispatchMode, 'configured-but-locked');
    assert.equal(adapter.body.capabilities.externalDelivery, false);
    assert.equal(adapter.body.realDeliveryAllowed, false);
    assert.ok(!JSON.stringify(adapter.body).includes('pmta-secret'));
  });
});

test('local capture provider validates and records only controlled-domain messages without delivery', async () => {
  resetLocalCaptureForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_MAIL_PROVIDER: 'local-capture',
    ORACLESTREET_LOCAL_CAPTURE_ALLOWED_DOMAIN: 'example.test'
  }, async () => {
    const unauth = await request('/api/email/local-capture');
    assert.equal(unauth.status, 401);
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const validation = await request('/api/email/provider/validate', { method: 'POST', headers: { cookie } });
    assert.equal(validation.status, 200);
    assert.equal(validation.body.validation.ok, true);
    assert.equal(validation.body.validation.provider, 'local-capture');
    assert.equal(validation.body.validation.checks.externalDelivery, false);

    const rejected = await request('/api/email/test-send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'outside@other.test',
        subject: 'Outside capture test',
        html: '<p>Controlled test.</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('recipient_outside_local_capture_domain'));

    const accepted = await request('/api/email/test-send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'owned@example.test',
        subject: 'Local capture smoke',
        html: '<p>Controlled capture.</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.provider, 'local-capture');
    assert.equal(accepted.body.realDelivery, false);

    const capture = await request('/api/email/local-capture', { headers: { cookie } });
    assert.equal(capture.status, 200);
    assert.equal(capture.body.count, 1);
    assert.equal(capture.body.messages[0].to, 'owned@example.test');
    assert.equal(capture.body.messages[0].externalDelivery, false);
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
  const adapter = await request('/email/provider/adapter');
  assert.equal(adapter.status, 401);
  const capture = await request('/email/local-capture');
  assert.equal(capture.status, 401);
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
  const dispatch = await request('/api/send-queue/dispatch-next-dry-run', { method: 'POST' });
  assert.equal(dispatch.status, 401);
  const readiness = await request('/api/send-queue/readiness');
  assert.equal(readiness.status, 401);
});

test('send queue readiness reports dry-run dispatch gates without mutation', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  resetSendQueueForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const enqueued = await request('/api/send-queue/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        to: 'readiness@example.test',
        subject: 'Readiness queue smoke',
        html: '<p>Controlled queue test.</p><p>unsubscribe</p>',
        consentStatus: 'opt_in',
        source: 'owned controlled inbox'
      })
    });
    assert.equal(enqueued.status, 200);

    const readiness = await request('/api/send-queue/readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'send-queue-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.totals.allJobs, 1);
    assert.equal(readiness.body.totals.queuedDryRuns, 1);
    assert.equal(readiness.body.totals.nonDryRunJobs, 0);
    assert.equal(readiness.body.dispatchPolicy.current, 'manual_one_dry_run_job_at_a_time');
    assert.equal(readiness.body.dispatchPolicy.externalDelivery, 'locked');
    assert.equal(readiness.body.gates.suppression, 'checked_before_enqueue');
    assert.deepEqual(readiness.body.sampleQueuedJobIds, [enqueued.body.job.id]);
    assert.equal(readiness.body.safety.noQueueMutation, true);
    assert.equal(readiness.body.safety.noDispatch, true);
    assert.equal(readiness.body.realDeliveryAllowed, false);

    const list = await request('/api/send-queue', { headers: { cookie } });
    assert.equal(list.body.jobs[0].status, 'queued_dry_run');
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'send_queue_readiness_view'));
  });
});

test('send queue enqueues and dispatches only compliant dry-run messages without delivery', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
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

    const dispatched = await request('/api/send-queue/dispatch-next-dry-run', {
      method: 'POST',
      headers: { cookie }
    });
    assert.equal(dispatched.status, 200);
    assert.equal(dispatched.body.mode, 'dry-run-dispatch');
    assert.equal(dispatched.body.job.status, 'dispatched_dry_run');
    assert.equal(dispatched.body.job.safety.dispatchMode, 'no_external_delivery');
    assert.equal(dispatched.body.realDelivery, false);
    assert.equal(dispatched.body.event.type, 'dispatched');
    assert.equal(dispatched.body.event.email, 'owned-inbox@example.test');

    const afterDispatch = await request('/api/send-queue', { headers: { cookie } });
    assert.equal(afterDispatch.body.jobs[0].status, 'dispatched_dry_run');
    const events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 1);
    assert.equal(events.body.events[0].type, 'dispatched');
    const reporting = await request('/api/email/reporting', { headers: { cookie } });
    assert.equal(reporting.body.totals.dispatched, 1);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'send_queue_dispatch_dry_run'));
  });
});

test('send queue endpoints also work behind nginx stripped api prefix', async () => {
  const res = await request('/send-queue/enqueue', { method: 'POST' });
  assert.equal(res.status, 401);
  const dispatch = await request('/send-queue/dispatch-next-dry-run', { method: 'POST' });
  assert.equal(dispatch.status, 401);
  const readiness = await request('/send-queue/readiness');
  assert.equal(readiness.status, 401);
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
  resetAuditLogForTests();
  await withAdminEnv(async () => {
    const res = await request('/api/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Reader@Example.test', source: 'link smoke' })
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'tracked-unsubscribe');
    assert.equal(res.body.suppression.email, 'reader@example.test');
    assert.equal(res.body.suppression.reason, 'unsubscribe');

    const tracked = await request('/unsubscribe?email=Tracked%40Example.test&source=campaign%3Acmp_123&campaignId=cmp_123&contactId=ct_123');
    assert.equal(tracked.status, 200);
    assert.equal(tracked.body.mode, 'tracked-unsubscribe');
    assert.equal(tracked.body.suppression.email, 'tracked@example.test');
    assert.equal(tracked.body.suppression.source, 'campaign:cmp_123');
    assert.equal(tracked.body.campaignId, 'cmp_123');
    assert.equal(tracked.body.contactId, 'ct_123');
    assert.equal(tracked.body.realDelivery, false);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const list = await request('/api/suppressions', { headers: { cookie } });
    assert.equal(list.body.count, 2);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'unsubscribe_record' && event.details.method === 'GET'));
  });
});

test('suppression and unsubscribe endpoints also work behind nginx stripped api prefix', async () => {
  const suppressions = await request('/suppressions');
  assert.equal(suppressions.status, 401);
  const unsubscribe = await request('/unsubscribe?email=bad');
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

test('bounce mailbox readiness reports safe receive posture without connecting', async () => {
  resetAuditLogForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/bounce-mailbox/readiness');
    assert.equal(unauth.status, 401);
  });

  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_BOUNCE_MAILBOX_HOST: 'imap.example.test',
    ORACLESTREET_BOUNCE_MAILBOX_PORT: '993',
    ORACLESTREET_BOUNCE_MAILBOX_USERNAME: 'bounces@example.test',
    ORACLESTREET_BOUNCE_MAILBOX_PASSWORD: 'mailbox-secret',
    ORACLESTREET_BOUNCE_MAILBOX_FOLDER: 'INBOX.Bounces',
    ORACLESTREET_BOUNCE_MAILBOX_SECURE: 'true',
    ORACLESTREET_BOUNCE_MAILBOX_POLL_ENABLED: 'false'
  }, async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/email/bounce-mailbox/readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'bounce-mailbox-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.mailbox.hostConfigured, true);
    assert.equal(readiness.body.mailbox.username, 'bo***@example.test');
    assert.equal(JSON.stringify(readiness.body).includes('mailbox-secret'), false);
    assert.equal(readiness.body.safety.noNetworkProbe, true);
    assert.equal(readiness.body.safety.noMailboxConnection, true);
    assert.equal(readiness.body.realDeliveryAllowed, false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_bounce_mailbox_readiness_view'));
  });
});

test('PowerMTA accounting import records valid delivery CSV atomically', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/powermta/accounting/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv: 'recipient,status\nbounced@example.test,5.1.1' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const rejected = await request('/api/email/powermta/accounting/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ csv: 'recipient,status,action\nbad-recipient,5.1.1,failed\nvalid@example.test,2.0.0,delivered' })
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.ok, false);
    assert.equal(rejected.body.eventRecorded, false);

    let events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 0);

    const imported = await request('/api/email/powermta/accounting/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        source: 'owned pmta accounting import',
        csv: 'recipient,status,action,diagnostic,campaignId,contactId,messageId\nHard@Example.test,5.1.1,failed,"550 mailbox",cmp_pmta,ct_hard,msg-hard\nSlow@Example.test,4.2.0,delayed,"451 temp",cmp_pmta,ct_slow,msg-slow\nOk@Example.test,2.0.0,delivered,"250 ok",cmp_pmta,ct_ok,msg-ok'
      })
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.ok, true);
    assert.equal(imported.body.mode, 'powermta-accounting-import');
    assert.equal(imported.body.acceptedCount, 3);
    assert.equal(imported.body.suppressionCreated, true);
    assert.equal(imported.body.realDelivery, false);
    assert.equal(imported.body.safety.noNetworkProbe, true);

    events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 3);
    assert.deepEqual(events.body.events.map((event) => event.type), ['bounce', 'deferred', 'delivered']);
    assert.deepEqual(events.body.events.map((event) => event.providerMessageId), ['msg-hard', 'msg-slow', 'msg-ok']);

    const lookupMissing = await request('/api/email/events/provider-message', { headers: { cookie } });
    assert.equal(lookupMissing.status, 400);
    assert.equal(lookupMissing.body.error, 'provider_message_id_required');

    const lookup = await request('/api/email/events/provider-message?providerMessageId=msg-hard', { headers: { cookie } });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.mode, 'provider-message-event-lookup');
    assert.equal(lookup.body.count, 1);
    assert.equal(lookup.body.events[0].email, 'hard@example.test');
    assert.equal(lookup.body.events[0].type, 'bounce');
    assert.equal(lookup.body.safety.noEventRecorded, true);

    const suppressions = await request('/api/suppressions', { headers: { cookie } });
    assert.equal(suppressions.body.count, 1);
    assert.equal(suppressions.body.suppressions[0].email, 'hard@example.test');
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_powermta_accounting_import'));
  });
});

test('PowerMTA accounting import validation parses delivery CSV without recording events', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/powermta/accounting/validate-import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv: 'recipient,status\nbounced@example.test,5.1.1' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const validation = await request('/api/email/powermta/accounting/validate-import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        source: 'owned pmta accounting sample',
        csv: 'recipient,dsnStatus,dsnAction,diagnostic,campaignId,contactId,messageId\nHard@Example.test,5.1.1,failed,"550 mailbox",cmp_pmta,ct_hard,msg1\nSlow@Example.test,4.2.0,delayed,"451 temp",cmp_pmta,ct_slow,msg2\nOk@Example.test,2.0.0,delivered,"250 ok",cmp_pmta,ct_ok,msg3\nbad-recipient,5.0.0,failed,"bad row",cmp_pmta,ct_bad,msg4'
      })
    });
    assert.equal(validation.status, 200);
    assert.equal(validation.body.mode, 'powermta-accounting-import-validate');
    assert.equal(validation.body.ok, false);
    assert.equal(validation.body.acceptedCount, 3);
    assert.equal(validation.body.rejectedCount, 1);
    assert.deepEqual(validation.body.accepted.map((row) => row.event.type), ['bounce', 'deferred', 'delivered']);
    assert.equal(validation.body.accepted[0].event.email, 'hard@example.test');
    assert.equal(validation.body.accepted[0].event.providerMessageId, 'msg1');
    assert.ok(validation.body.rejected[0].errors.includes('valid_recipient_required'));
    assert.equal(validation.body.safety.validationOnly, true);
    assert.equal(validation.body.realDelivery, false);

    const events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 0);
    const suppressions = await request('/api/suppressions', { headers: { cookie } });
    assert.equal(suppressions.body.count, 0);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_powermta_accounting_import_validate'));
  });
});

test('manual bounce parser validates DSN text without recording events or suppressions', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/bounce-parse/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Final-Recipient: rfc822; bounced@example.test\nStatus: 5.1.1' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const parsed = await request('/api/email/bounce-parse/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        source: 'owned pmta bounce mailbox sample',
        campaignId: 'cmp_bounce_parse',
        contactId: 'ct_bounce_parse',
        message: 'Final-Recipient: rfc822; Bounced@Example.test\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 mailbox unavailable'
      })
    });
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.mode, 'manual-bounce-parse-validate');
    assert.equal(parsed.body.ok, true);
    assert.equal(parsed.body.parsed.type, 'bounce');
    assert.equal(parsed.body.parsed.email, 'bounced@example.test');
    assert.equal(parsed.body.parsed.status, '5.1.1');
    assert.equal(parsed.body.parsed.campaignId, 'cmp_bounce_parse');
    assert.equal(parsed.body.safety.validationOnly, true);
    assert.equal(parsed.body.safety.noEventRecorded, true);
    assert.equal(parsed.body.safety.noSuppressionCreated, true);
    assert.equal(parsed.body.realDelivery, false);

    const deferred = await request('/api/email/bounce-parse/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'Final-Recipient: rfc822; slow@example.test\nAction: delayed\nStatus: 4.2.0' })
    });
    assert.equal(deferred.body.parsed.type, 'deferred');

    const events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 0);
    const suppressions = await request('/api/suppressions', { headers: { cookie } });
    assert.equal(suppressions.body.count, 0);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_bounce_parse_validate'));
  });
});

test('manual bounce parser ingest records parsed bounces and suppresses hard failures only', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/bounce-parse/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Final-Recipient: rfc822; bounced@example.test\nStatus: 5.1.1' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const hard = await request('/api/email/bounce-parse/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        source: 'owned pmta bounce mailbox sample',
        campaignId: 'cmp_bounce_ingest',
        contactId: 'ct_bounce_ingest',
        message: 'Final-Recipient: rfc822; Hard@Example.test\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 mailbox unavailable'
      })
    });
    assert.equal(hard.status, 200);
    assert.equal(hard.body.mode, 'manual-bounce-parse-ingest');
    assert.equal(hard.body.event.type, 'bounce');
    assert.equal(hard.body.event.email, 'hard@example.test');
    assert.equal(hard.body.suppression.reason, 'bounce');
    assert.equal(hard.body.eventRecorded, true);
    assert.equal(hard.body.suppressionCreated, true);
    assert.equal(hard.body.realDelivery, false);

    const deferred = await request('/api/email/bounce-parse/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ message: 'Final-Recipient: rfc822; Slow@Example.test\nAction: delayed\nStatus: 4.2.0' })
    });
    assert.equal(deferred.status, 200);
    assert.equal(deferred.body.event.type, 'deferred');
    assert.equal(deferred.body.suppressionCreated, false);

    const events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 2);
    assert.deepEqual(events.body.events.map((event) => event.type), ['bounce', 'deferred']);
    const suppressions = await request('/api/suppressions', { headers: { cookie } });
    assert.equal(suppressions.body.count, 1);
    assert.equal(suppressions.body.suppressions[0].email, 'hard@example.test');
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_bounce_parse_ingest'));
  });
});

test('manual event import validation parses CSV without recording events', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/events/validate-import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv: 'type,email,source\nbounce,bounced@example.test,pmta csv' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const validation = await request('/api/email/events/validate-import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        csv: 'type,email,source,detail,campaignId,contactId\n"bounce",Bounced@Example.test,"pmta csv","550 mailbox",cmp_123,ct_123\nopen,reader@example.test,tracking pixel,,cmp_123,ct_124'
      })
    });
    assert.equal(validation.status, 200);
    assert.equal(validation.body.mode, 'manual-event-import-validate');
    assert.equal(validation.body.ok, false);
    assert.equal(validation.body.acceptedCount, 1);
    assert.equal(validation.body.rejectedCount, 1);
    assert.equal(validation.body.accepted[0].event.type, 'bounce');
    assert.equal(validation.body.accepted[0].event.email, 'bounced@example.test');
    assert.equal(validation.body.accepted[0].event.campaignId, 'cmp_123');
    assert.ok(validation.body.rejected[0].errors.includes('valid_event_type_required'));
    assert.equal(validation.body.realDelivery, false);

    const events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 0);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_events_import_validate'));
  });
});

test('manual event CSV import atomically ingests valid bounce and complaint rows only', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/events/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv: 'type,email,source\nbounce,bounced@example.test,pmta csv' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const rejected = await request('/api/email/events/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ csv: 'type,email,source\nbounce,bounced@example.test,pmta csv\nopen,reader@example.test,tracking' })
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.imported, false);
    assert.equal(rejected.body.acceptedCount, 1);
    assert.equal(rejected.body.rejectedCount, 1);
    assert.equal((await request('/api/email/events', { headers: { cookie } })).body.count, 0);

    const imported = await request('/api/email/events/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        csv: 'type,email,source,detail,campaignId,contactId\nbounce,Bounced@Example.test,pmta csv,550,cmp_csv,ct_1\ncomplaint,complaint@example.test,abuse inbox,,cmp_csv,ct_2'
      })
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.mode, 'manual-event-import-ingest');
    assert.equal(imported.body.imported, true);
    assert.equal(imported.body.importedCount, 2);
    assert.equal(imported.body.realDelivery, false);
    assert.equal(imported.body.ingest.accepted[0].event.campaignId, 'cmp_csv');
    assert.equal(imported.body.ingest.accepted[0].suppression.reason, 'bounce');

    const events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 2);
    assert.equal(events.body.events[0].campaignId, 'cmp_csv');
    const suppressions = await request('/api/suppressions', { headers: { cookie } });
    assert.equal(suppressions.body.count, 2);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_events_import' && event.status === 'ok'));
  });
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

test('manual delivery event ingest records delivered and deferred without suppression', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  resetSuppressionsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/delivery-events/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ type: 'delivered', email: 'delivered@example.test' }] })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const ingest = await request('/api/email/delivery-events/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: [
        { type: 'delivered', email: 'Delivered@Example.test', source: 'pmta accounting dry-run review', campaignId: 'cmp_delivery' },
        { type: 'deferred', email: 'slow@example.test', detail: '421 temporary deferral' },
        { type: 'bounce', email: 'blocked@example.test', source: 'wrong endpoint' }
      ] })
    });
    assert.equal(ingest.status, 200);
    assert.equal(ingest.body.mode, 'manual-delivery-event-ingest');
    assert.equal(ingest.body.ok, false);
    assert.equal(ingest.body.acceptedCount, 2);
    assert.equal(ingest.body.rejectedCount, 1);
    assert.equal(ingest.body.accepted[0].event.type, 'delivered');
    assert.equal(ingest.body.accepted[0].event.email, 'delivered@example.test');
    assert.equal(ingest.body.accepted[0].suppression, null);
    assert.equal(ingest.body.suppressionCreated, false);
    assert.ok(ingest.body.rejected[0].errors.includes('valid_delivery_event_type_required'));
    assert.equal(ingest.body.realDelivery, false);

    const suppressions = await request('/api/suppressions', { headers: { cookie } });
    assert.equal(suppressions.body.count, 0);
    const reporting = await request('/api/email/reporting', { headers: { cookie } });
    assert.equal(reporting.body.totals.delivered, 1);
    assert.equal(reporting.body.totals.deferred, 1);
    assert.equal(reporting.body.safety.complianceGates.deliveryEvents, 'manual_delivery_ingest_records_delivered_deferred_without_suppression');
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_delivery_events_ingest'));
  });
});

test('manual event ingest rejects internal dispatched events', async () => {
  resetEmailEventsForTests();
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const res = await request('/api/email/events/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: [{ type: 'dispatched', email: 'owned@example.test', source: 'manual' }] })
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.rejectedCount, 1);
    assert.ok(res.body.rejected[0].errors.includes('valid_event_type_required'));
  });
});

test('tracked open and click endpoints record engagement without auth or delivery', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  await withAdminEnv(async () => {
    const missingEmail = await request('/api/track/open?campaignId=cmp_track');
    assert.equal(missingEmail.status, 400);
    assert.ok(missingEmail.body.errors.includes('valid_email_required'));

    const open = await request('/api/track/open?email=Reader@Example.test&campaignId=cmp_track&contactId=ct_track');
    assert.equal(open.status, 200);
    assert.equal(open.body.mode, 'tracked-open-event');
    assert.equal(open.body.event.type, 'open');
    assert.equal(open.body.event.email, 'reader@example.test');
    assert.equal(open.body.event.campaignId, 'cmp_track');
    assert.equal(open.body.realDelivery, false);

    const click = await request('/api/track/click?email=reader@example.test&campaignId=cmp_track&contactId=ct_track&url=https%3A%2F%2Fexample.test%2Foffer');
    assert.equal(click.status, 200);
    assert.equal(click.body.mode, 'tracked-click-event');
    assert.equal(click.body.redirect, false);
    assert.equal(click.body.event.type, 'click');
    assert.equal(click.body.event.detail, 'https://example.test/offer');

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const events = await request('/api/email/events', { headers: { cookie } });
    assert.equal(events.body.count, 2);
    assert.equal(events.body.events[0].type, 'open');
    assert.equal(events.body.events[1].type, 'click');

    const reporting = await request('/api/email/reporting', { headers: { cookie } });
    assert.equal(reporting.body.totals.opens, 1);
    assert.equal(reporting.body.totals.clicks, 1);
    assert.equal(reporting.body.safety.complianceGates.engagementTracking, 'tracked_open_click_records_event_without_delivery');

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_tracking_open'));
    assert.ok(audit.body.events.some((event) => event.action === 'email_tracking_click'));
  });
});

test('email event endpoints also work behind nginx stripped api prefix', async () => {
  const providerMessageEvents = await request('/email/events/provider-message?providerMessageId=msg-test');
  assert.equal(providerMessageEvents.status, 401);
  const list = await request('/email/events');
  assert.equal(list.status, 401);
  const pmtaAccountingImport = await request('/email/powermta/accounting/import', { method: 'POST' });
  assert.equal(pmtaAccountingImport.status, 401);
  const pmtaAccounting = await request('/email/powermta/accounting/validate-import', { method: 'POST' });
  assert.equal(pmtaAccounting.status, 401);
  const bounceMailbox = await request('/email/bounce-mailbox/readiness');
  assert.equal(bounceMailbox.status, 401);
  const bounceParse = await request('/email/bounce-parse/validate', { method: 'POST' });
  assert.equal(bounceParse.status, 401);
  const bounceIngest = await request('/email/bounce-parse/ingest', { method: 'POST' });
  assert.equal(bounceIngest.status, 401);
  const validateImport = await request('/email/events/validate-import', { method: 'POST' });
  assert.equal(validateImport.status, 401);
  const importEvents = await request('/email/events/import', { method: 'POST' });
  assert.equal(importEvents.status, 401);
  const ingest = await request('/email/events/ingest', { method: 'POST' });
  assert.equal(ingest.status, 401);
  const deliveryIngest = await request('/email/delivery-events/ingest', { method: 'POST' });
  assert.equal(deliveryIngest.status, 401);
  const open = await request('/track/open?email=reader@example.test');
  assert.equal(open.status, 200);
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
    assert.equal(report.body.sendingReadiness.readyForRealDelivery, false);
    assert.ok(report.body.sendingReadiness.blockers.includes('real_email_flag_disabled'));

    const dashboard = await request('/api/dashboard', { headers: { cookie } });
    assert.equal(dashboard.body.summary.queuedSends, 1);
    assert.equal(dashboard.body.summary.bounces, 1);
  });
});

test('email reporting export preview requires admin and returns safe CSV without delivery', async () => {
  resetAuditLogForTests();
  resetSendQueueForTests();
  resetSuppressionsForTests();
  resetEmailEventsForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/reporting/export?dataset=summary');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    await request('/api/suppressions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'export-block@example.test', reason: 'manual', source: 'export smoke' })
    });
    await request('/api/email/events/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: [{ type: 'complaint', email: 'complaint-export@example.test', source: 'export smoke' }] })
    });

    const exportPreview = await request('/api/email/reporting/export?dataset=suppressions', { headers: { cookie } });
    assert.equal(exportPreview.status, 200);
    assert.equal(exportPreview.body.mode, 'reporting-export-safe-preview');
    assert.equal(exportPreview.body.dataset, 'suppressions');
    assert.equal(exportPreview.body.format, 'csv');
    assert.equal(exportPreview.body.rowsExported, 2);
    assert.match(exportPreview.body.csv, /email,reason,source/);
    assert.match(exportPreview.body.csv, /export-block@example\.test/);
    assert.equal(exportPreview.body.realDeliveryAllowed, false);
    assert.equal(exportPreview.body.safety.noSecretsIncluded, true);

    const rejected = await request('/api/email/reporting/export?dataset=secrets', { headers: { cookie } });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('valid_export_dataset_required'));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'reporting_export_preview'));
  });
});

test('email reporting endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/email/reporting');
  assert.equal(res.status, 401);
  const exportPreview = await request('/email/reporting/export?dataset=summary');
  assert.equal(exportPreview.status, 401);
});

test('warm-up planner requires admin session and returns safe sender-domain preview without delivery', async () => {
  resetAuditLogForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/warmup/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'stuffprettygood.com' })
    });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const plan = await request('/api/email/warmup/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ domain: 'StuffPrettyGood.com', startDailyCap: 10, maxDailyCap: 25, rampPercent: 50, days: 3 })
    });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.mode, 'warmup-plan-safe-preview');
    assert.equal(plan.body.domain, 'stuffprettygood.com');
    assert.equal(plan.body.schedule.length, 3);
    assert.deepEqual(plan.body.schedule.map((day) => day.dailyCap), [10, 15, 23]);
    assert.equal(plan.body.gates.suppressionRequired, true);
    assert.equal(plan.body.safety.noProviderMutation, true);
    assert.equal(plan.body.realDeliveryAllowed, false);

    const rejected = await request('/api/email/warmup/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ domain: 'bad domain', days: 91 })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('valid_sender_domain_required'));
    assert.ok(rejected.body.errors.includes('valid_days_1_90_required'));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_warmup_plan_preview'));
  });
});

test('warm-up policy persistence and schedule cap checks are protected and dry-run enforced', async () => {
  resetAuditLogForTests();
  resetContactsForTests();
  resetSegmentsForTests();
  resetTemplatesForTests();
  resetCampaignsForTests();
  resetWarmupPoliciesForTests();
  await withAdminEnv(async () => {
    const unauthPolicy = await request('/api/email/warmup/policy');
    assert.equal(unauthPolicy.status, 401);
    const unauthCap = await request('/api/email/warmup/schedule-cap', { method: 'POST' });
    assert.equal(unauthCap.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const saved = await request('/api/email/warmup/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ domain: 'Example.test', startDate: new Date().toISOString().slice(0, 10), startDailyCap: 1, maxDailyCap: 5, rampPercent: 100, days: 3 })
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.mode, 'warmup-policy-saved');
    assert.equal(saved.body.policy.domain, 'example.test');
    assert.equal(saved.body.policy.enforcementMode, 'dry-run-schedule-gate');
    assert.equal(saved.body.realDeliveryAllowed, false);

    const capOk = await request('/api/email/warmup/schedule-cap', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ domain: 'example.test', scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), estimatedAudience: 1 })
    });
    assert.equal(capOk.status, 200);
    assert.equal(capOk.body.mode, 'warmup-schedule-cap-evaluation');
    assert.equal(capOk.body.capExceeded, false);
    assert.equal(capOk.body.enforcement.dryRunOnly, true);

    const capRejected = await request('/api/email/warmup/schedule-cap', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ domain: 'example.test', scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), estimatedAudience: 2 })
    });
    assert.equal(capRejected.status, 400);
    assert.equal(capRejected.body.capExceeded, true);
    assert.ok(capRejected.body.errors.includes('warmup_daily_cap_exceeded'));

    await request('/api/contacts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contacts: [
        { email: 'one@example.test', consentStatus: 'opt_in', source: 'owned signup form' },
        { email: 'two@example.test', consentStatus: 'opt_in', source: 'owned signup form' }
      ] })
    });
    const segment = await request('/api/segments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Example', criteria: { domain: 'example.test' } })
    });
    const template = await request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Warmup Template', subject: 'Warmup', html: '<p>Hello</p><p>unsubscribe here</p>' })
    });
    const campaign = await request('/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Warmup cap test', segmentId: segment.body.segment.id, templateId: template.body.template.id })
    });
    await request('/api/campaigns/approve-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id })
    });
    const scheduleRejected = await request('/api/campaigns/schedule-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id, senderDomain: 'example.test', scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    });
    assert.equal(scheduleRejected.status, 400);
    assert.ok(scheduleRejected.body.errors.includes('warmup_daily_cap_exceeded'));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_warmup_policy_save'));
    assert.ok(audit.body.events.some((event) => event.action === 'email_warmup_schedule_cap_evaluate'));
  });
});

test('campaign calendar shows scheduled dry-runs against warmup caps without queue or provider mutation', async () => {
  resetAuditLogForTests();
  resetContactsForTests();
  resetSegmentsForTests();
  resetTemplatesForTests();
  resetCampaignsForTests();
  resetWarmupPoliciesForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/campaigns/calendar?days=7');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const startDate = new Date().toISOString().slice(0, 10);
    await request('/api/email/warmup/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ domain: 'calendar.test', startDate, startDailyCap: 1, maxDailyCap: 4, rampPercent: 100, days: 4 })
    });
    await request('/api/contacts/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contacts: [{ email: 'calendar-one@calendar.test', consentStatus: 'opt_in', source: 'owned calendar smoke' }] })
    });
    const segment = await request('/api/segments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Calendar test', criteria: { domain: 'calendar.test' } })
    });
    const template = await request('/api/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Calendar Template', subject: 'Calendar', html: '<p>Hello</p><p>unsubscribe here</p>' })
    });
    const campaign = await request('/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Calendar dry-run', segmentId: segment.body.segment.id, templateId: template.body.template.id })
    });
    await request('/api/campaigns/approve-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id })
    });
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduled = await request('/api/campaigns/schedule-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: campaign.body.campaign.id, senderDomain: 'calendar.test', scheduledAt })
    });
    assert.equal(scheduled.status, 200);

    const calendar = await request('/api/campaigns/calendar?domain=calendar.test&days=7', { headers: { cookie } });
    assert.equal(calendar.status, 200);
    assert.equal(calendar.body.mode, 'campaign-calendar-warmup-caps');
    assert.equal(calendar.body.safety.noQueueMutation, true);
    assert.equal(calendar.body.safety.noProviderMutation, true);
    assert.equal(calendar.body.realDeliveryAllowed, false);
    assert.equal(calendar.body.totals.scheduledCampaigns, 1);
    assert.ok(calendar.body.calendar.some((day) => day.scheduledCount === 1 && day.dailyCap >= 1 && day.campaigns.some((entry) => entry.name === 'Calendar dry-run')));

    const second = await request('/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Calendar over cap', segmentId: segment.body.segment.id, templateId: template.body.template.id })
    });
    await request('/api/campaigns/approve-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: second.body.campaign.id })
    });
    const overCap = await request('/api/campaigns/schedule-dry-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ campaignId: second.body.campaign.id, senderDomain: 'calendar.test', scheduledAt })
    });
    assert.equal(overCap.status, 400);
    assert.ok(overCap.body.errors.includes('warmup_daily_cap_exceeded'));
    assert.equal(overCap.body.warmupCap.existingScheduledCount, 1);

    const queue = await request('/api/send-queue', { headers: { cookie } });
    assert.equal(queue.body.count, 0);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'campaign_calendar_view'));
  });
});

test('reputation auto-pause threshold controls are protected, recommendation-only, and auditable', async () => {
  resetAuditLogForTests();
  resetEmailEventsForTests();
  resetReputationControlsForTests();
  await withAdminEnv(async () => {
    const unauthPolicy = await request('/api/email/reputation/policy');
    assert.equal(unauthPolicy.status, 401);
    const unauthEvaluate = await request('/api/email/reputation/auto-pause');
    assert.equal(unauthEvaluate.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const saved = await request('/api/email/reputation/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        domain: 'Example.test',
        bounceRateThreshold: 0.2,
        complaintRateThreshold: 0.5,
        deferralRateThreshold: 0.5,
        providerErrorRateThreshold: 0.5,
        minimumEvents: 3
      })
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.mode, 'reputation-auto-pause-policy-saved');
    assert.equal(saved.body.policy.domain, 'example.test');
    assert.equal(saved.body.policy.actionMode, 'recommendation_only');
    assert.equal(saved.body.mutationScope, 'policy_only_no_queue_or_provider_pause');
    assert.equal(saved.body.realDeliveryAllowed, false);

    await request('/api/email/delivery-events/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: [
        { type: 'delivered', email: 'one@example.test', source: 'qa' },
        { type: 'deferred', email: 'two@example.test', source: 'qa' }
      ] })
    });
    await request('/api/email/events/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ events: [
        { type: 'bounce', email: 'three@example.test', source: 'qa' }
      ] })
    });

    const evaluation = await request('/api/email/reputation/auto-pause?domain=example.test', { headers: { cookie } });
    assert.equal(evaluation.status, 200);
    assert.equal(evaluation.body.mode, 'reputation-auto-pause-evaluation');
    assert.equal(evaluation.body.recommendPause, true);
    assert.ok(evaluation.body.thresholdBreaches.includes('bounce_rate_threshold_exceeded'));
    assert.equal(evaluation.body.safety.recommendationOnly, true);
    assert.equal(evaluation.body.safety.noQueueMutation, true);
    assert.equal(evaluation.body.realDeliveryAllowed, false);

    const rejected = await request('/api/email/reputation/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ domain: 'bad domain', bounceRateThreshold: 2 })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('valid_sender_domain_required'));
    assert.ok(rejected.body.errors.includes('bounceRateThreshold_must_be_between_0_and_1'));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_reputation_policy_save'));
    assert.ok(audit.body.events.some((event) => event.action === 'email_reputation_auto_pause_evaluate'));
  });
});

test('warm-up and reputation endpoints also work behind nginx stripped api prefix', async () => {
  const warmup = await request('/email/warmup/plan', { method: 'POST' });
  assert.equal(warmup.status, 401);
  const warmupPolicy = await request('/email/warmup/policy');
  assert.equal(warmupPolicy.status, 401);
  const warmupCap = await request('/email/warmup/schedule-cap', { method: 'POST' });
  assert.equal(warmupCap.status, 401);
  const policy = await request('/email/reputation/policy');
  assert.equal(policy.status, 401);
  const autoPause = await request('/email/reputation/auto-pause');
  assert.equal(autoPause.status, 401);
});

test('sending readiness endpoint requires admin session and keeps real delivery locked', async () => {
  resetAuditLogForTests();
  await withAdminEnv(async () => {
    const unauth = await request('/api/email/sending-readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/email/sending-readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'sending-readiness-safe-gate');
    assert.equal(readiness.body.readyForRealDelivery, false);
    assert.equal(readiness.body.realDeliveryAllowed, false);
    assert.equal(readiness.body.requiredGates.consentSourceEnforced, true);
    assert.equal(readiness.body.requiredGates.suppressionEnforced, true);
    assert.equal(readiness.body.requiredGates.unsubscribeRequired, true);
    assert.equal(readiness.body.requiredGates.senderDomainReady, false);
    assert.equal(readiness.body.domainReadiness.mode, 'sender-domain-readiness-safe-gate');
    assert.ok(readiness.body.blockers.includes('real_email_flag_disabled'));
    assert.ok(readiness.body.blockers.includes('live_provider_not_selected'));
    assert.ok(readiness.body.blockers.includes('sender_domain_not_ready'));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_sending_readiness_view'));
  });
});

test('controlled live test readiness requires all gates and never sends', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_MAIL_PROVIDER: 'powermta',
    ORACLESTREET_REAL_EMAIL_ENABLED: 'true',
    ORACLESTREET_POWERMTA_HOST: 'pmta.example.test',
    ORACLESTREET_POWERMTA_PORT: '587',
    ORACLESTREET_POWERMTA_USERNAME: 'pmta-user',
    ORACLESTREET_POWERMTA_PASSWORD: 'pmta-secret',
    ORACLESTREET_POWERMTA_FROM_EMAIL: 'sender@stuffprettygood.com',
    ORACLESTREET_DEFAULT_FROM_EMAIL: 'sender@stuffprettygood.com',
    ORACLESTREET_PRIMARY_DOMAIN: 'stuffprettygood.com',
    ORACLESTREET_BOUNCE_MAILBOX_HOST: 'imap.example.test',
    ORACLESTREET_BOUNCE_MAILBOX_USERNAME: 'bounces@example.test',
    ORACLESTREET_BOUNCE_MAILBOX_PASSWORD: 'mailbox-secret',
    ORACLESTREET_CONTROLLED_TEST_RECIPIENT_EMAIL: 'owned-inbox@example.test',
    ORACLESTREET_CONTROLLED_TEST_RECIPIENT_OWNED: 'true',
    ORACLESTREET_CONTROLLED_LIVE_TEST_APPROVED: 'false',
    ORACLESTREET_RATE_LIMIT_GLOBAL_PER_HOUR: '1',
    ORACLESTREET_RATE_LIMIT_DOMAIN_PER_HOUR: '1'
  }, async () => {
    const unauth = await request('/api/email/controlled-live-test/readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/email/controlled-live-test/readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'controlled-live-test-readiness-safe-gate');
    assert.equal(readiness.body.provider.provider, 'powermta');
    assert.equal(readiness.body.recipient.email, 'ow***@example.test');
    assert.equal(readiness.body.readyForControlledLiveTest, false);
    assert.equal(readiness.body.safety.noSend, true);
    assert.equal(readiness.body.safety.maxMessagesIfLaterApproved, 1);
    assert.equal(readiness.body.realDeliveryAllowed, false);
    assert.ok(readiness.body.blockers.includes('explicit_human_approval_required'));
    assert.equal(JSON.stringify(readiness.body).includes('pmta-secret'), false);
    assert.equal(JSON.stringify(readiness.body).includes('mailbox-secret'), false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_controlled_live_test_readiness_view'));
  });
});

test('controlled live test runbook gate requires explicit proof and never sends', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_MAIL_PROVIDER: 'powermta',
    ORACLESTREET_POWERMTA_HOST: 'pmta.example.test',
    ORACLESTREET_POWERMTA_PORT: '587',
    ORACLESTREET_POWERMTA_USERNAME: 'pmta-user',
    ORACLESTREET_POWERMTA_PASSWORD: 'pmta-secret',
    ORACLESTREET_DEFAULT_FROM_EMAIL: 'sender@stuffprettygood.com',
    ORACLESTREET_CONTROLLED_TEST_RECIPIENT_EMAIL: 'owned-inbox@example.test',
    ORACLESTREET_CONTROLLED_TEST_RECIPIENT_OWNED: 'true'
  }, async () => {
    const unauth = await request('/api/email/controlled-live-test/plan', { method: 'POST', body: '{}' });
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const rejected = await request('/api/email/controlled-live-test/plan', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientEmail: 'owned-inbox@example.test', approvalPhrase: 'approve', dryRunProofId: 'dryrun_123' })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.blockers.includes('exact_live_test_approval_phrase_required'));
    assert.equal(rejected.body.safety.noSend, true);

    const planned = await request('/api/email/controlled-live-test/plan', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientEmail: 'owned-inbox@example.test', approvalPhrase: 'I_APPROVE_ONE_OWNED_RECIPIENT_LIVE_TEST', dryRunProofId: 'dryrun_123' })
    });
    assert.equal(planned.status, 200);
    assert.equal(planned.body.mode, 'controlled-live-test-runbook-gate');
    assert.equal(planned.body.acceptedForRunbook, true);
    assert.equal(planned.body.readyForControlledLiveTest, false);
    assert.equal(planned.body.recipient.email, 'ow***@example.test');
    assert.equal(planned.body.runbook.maxMessages, 1);
    assert.equal(planned.body.safety.requiresSeparateManualExecution, true);
    assert.equal(planned.body.realDeliveryAllowed, false);
    assert.equal(JSON.stringify(planned.body).includes('pmta-secret'), false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_controlled_live_test_plan'));
  });
});

test('controlled live test proof audit records manual outcomes without sending or leaking secrets', async () => {
  resetAuditLogForTests();
  resetControlledLiveTestProofAuditsForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_POWERMTA_PASSWORD: 'pmta-secret',
    ORACLESTREET_CONTROLLED_TEST_RECIPIENT_EMAIL: 'owned-inbox@example.test',
    ORACLESTREET_CONTROLLED_TEST_RECIPIENT_OWNED: 'true'
  }, async () => {
    const unauth = await request('/api/email/controlled-live-test/proof-audit');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const rejected = await request('/api/email/controlled-live-test/proof-audit', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientEmail: 'owned-inbox@example.test', dryRunProofId: 'dryrun_123', outcome: 'manual_one_message_sent' })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('provider_message_id_required_for_manual_send_record'));
    assert.equal(rejected.body.sendMutation, false);
    assert.equal(rejected.body.realDeliveryAllowed, false);

    const recorded = await request('/api/email/controlled-live-test/proof-audit', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ recipientEmail: 'owned-inbox@example.test', dryRunProofId: 'dryrun_123', providerMessageId: 'pmta-proof-001', outcome: 'manual_one_message_sent', notes: 'Manual out-of-band one-message proof recorded after operator action.' })
    });
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body.mode, 'controlled-live-test-proof-audit-log');
    assert.equal(recorded.body.record.outcome, 'manual_one_message_sent');
    assert.equal(recorded.body.record.recipient.email, 'ow***@example.test');
    assert.equal(recorded.body.record.safety.auditOnly, true);
    assert.equal(recorded.body.record.safety.noSend, true);
    assert.equal(recorded.body.record.safety.noProviderMutation, true);
    assert.equal(recorded.body.sendMutation, false);
    assert.equal(recorded.body.realDeliveryAllowed, false);
    assert.equal(JSON.stringify(recorded.body).includes('pmta-secret'), false);

    const list = await request('/api/email/controlled-live-test/proof-audit', { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal(list.body.count, 1);
    assert.equal(list.body.records[0].providerMessageId, 'pmta-proof-001');
    assert.equal(list.body.realDeliveryAllowed, false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_controlled_live_test_proof_audit_record'));
    assert.ok(audit.body.events.some((event) => event.action === 'email_controlled_live_test_proof_audit_list'));
  });
});

test('sender domain readiness endpoint requires admin session and reports safe DNS plan', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DEFAULT_FROM_EMAIL: 'sender@stuffprettygood.com',
    ORACLESTREET_PRIMARY_DOMAIN: 'stuffprettygood.com'
  }, async () => {
    const unauth = await request('/api/email/domain-readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/email/domain-readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'sender-domain-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.senderDomain, 'stuffprettygood.com');
    assert.equal(readiness.body.checks.senderDomainMatchesPrimary, true);
    assert.equal(readiness.body.checks.dnsNetworkProbe, 'skipped_safe_default');
    assert.equal(readiness.body.realDeliveryAllowed, false);
    assert.match(readiness.body.expectedDns.dmarc, /_dmarc\.stuffprettygood\.com/);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'email_domain_readiness_view'));
  });
});

test('sender domain readiness reports missing sender without delivery', async () => {
  await withAdminEnv(async () => {
    const login = await loginAsAdmin();
    const readiness = await request('/api/email/domain-readiness', { headers: { cookie: login.headers.get('set-cookie') } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.ok, false);
    assert.ok(readiness.body.errors.includes('valid_default_from_email_required'));
    assert.equal(readiness.body.realDeliveryAllowed, false);
  });
});

test('web domain readiness endpoint requires admin and reports HTTP/TLS plan without probes', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_PRIMARY_DOMAIN: 'stuffprettygood.com',
    ORACLESTREET_WWW_DOMAIN: 'www.stuffprettygood.com',
    ORACLESTREET_VPS_IP: '187.124.147.49',
    ORACLESTREET_TLS_MODE: 'http-only'
  }, async () => {
    const unauth = await request('/api/web/domain-readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/web/domain-readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'web-domain-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.primaryDomain, 'stuffprettygood.com');
    assert.equal(readiness.body.vpsIp, '187.124.147.49');
    assert.equal(readiness.body.dns.expectedApexA, 'A stuffprettygood.com 187.124.147.49');
    assert.equal(readiness.body.dns.networkProbe, 'skipped_use_deployment_smoke_tests');
    assert.equal(readiness.body.tls.mode, 'http-only');
    assert.equal(readiness.body.tls.httpsExpected, false);
    assert.equal(readiness.body.tls.realSendingUnlockedByTls, false);
    assert.equal(readiness.body.realDeliveryAllowed, false);
    assert.ok(readiness.body.smokeTests.some((command) => command.includes('stuffprettygood.com/api/health')));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'web_domain_readiness_view'));
  });
});

test('web TLS readiness endpoint requires admin and plans TLS without changing HTTPS', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_PRIMARY_DOMAIN: 'stuffprettygood.com',
    ORACLESTREET_WWW_DOMAIN: 'www.stuffprettygood.com',
    ORACLESTREET_VPS_IP: '187.124.147.49',
    ORACLESTREET_TLS_MODE: 'origin-certbot'
  }, async () => {
    const unauth = await request('/api/web/tls-readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/web/tls-readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'web-tls-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.tlsMode, 'origin-certbot');
    assert.equal(readiness.body.certificate.originCertbotSelected, true);
    assert.deepEqual(readiness.body.certificate.candidateDomains, ['stuffprettygood.com', 'www.stuffprettygood.com']);
    assert.equal(readiness.body.certificate.certificateProbe, 'skipped_safe_default');
    assert.equal(readiness.body.certificate.installation, 'not_automated_by_readiness_endpoint');
    assert.equal(readiness.body.httpsPlanned, true);
    assert.equal(readiness.body.realDeliveryAllowed, false);
    assert.ok(readiness.body.smokeTests.https.some((command) => command.includes('https://stuffprettygood.com/api/health')));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'web_tls_readiness_view'));
  });
});

test('backup readiness endpoint requires admin and reports safe plan without dumping data', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_DATABASE_URL: 'postgresql://oracle:super-secret@db.example.test:5432/oraclestreet',
    ORACLESTREET_BACKUP_PATH: '/var/backups/oraclestreet',
    ORACLESTREET_BACKUP_SCHEDULE: 'daily',
    ORACLESTREET_BACKUP_RETENTION_DAYS: '21'
  }, async () => {
    const unauth = await request('/api/backups/readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/backups/readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'backup-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.database.urlConfigured, true);
    assert.equal(readiness.body.database.secretsRedacted, true);
    assert.equal(readiness.body.database.dumpProbe, 'skipped_readiness_only');
    assert.equal(readiness.body.storage.path, '/var/backups/oraclestreet');
    assert.equal(readiness.body.schedule.retentionDays, 21);
    assert.equal(readiness.body.safety.noDumpCreated, true);
    assert.equal(readiness.body.safety.noFilesystemWrites, true);
    assert.equal(readiness.body.realDeliveryAllowed, false);
    assert.equal(JSON.stringify(readiness.body).includes('super-secret'), false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'backup_readiness_view'));
  });
});

test('monitoring readiness endpoint requires admin and reports safe checks without probing', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_PRIMARY_URL: 'http://stuffprettygood.com',
    ORACLESTREET_FALLBACK_URL: 'http://187.124.147.49',
    ORACLESTREET_MONITOR_INTERVAL_SECONDS: '300',
    ORACLESTREET_MONITOR_ALERT_TARGET: 'ops-internal'
  }, async () => {
    const unauth = await request('/api/monitoring/readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/monitoring/readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'monitoring-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.endpoints.primaryHealth, 'http://stuffprettygood.com/api/health');
    assert.equal(readiness.body.endpoints.endpointProbe, 'skipped_readiness_only');
    assert.equal(readiness.body.services.backend, 'oraclestreet-backend');
    assert.equal(readiness.body.services.serviceProbe, 'skipped_readiness_only');
    assert.equal(readiness.body.schedule.intervalSeconds, 300);
    assert.equal(readiness.body.alerts.targetConfigured, true);
    assert.equal(readiness.body.safety.noNetworkProbe, true);
    assert.equal(readiness.body.safety.noServiceMutation, true);
    assert.equal(readiness.body.realDeliveryAllowed, false);
    assert.ok(readiness.body.recommendedCommands.some((command) => command.includes('nginx -t')));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'monitoring_readiness_view'));
  });
});

test('platform rate-limit readiness requires admin and reports safe gates without traffic mutation', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_ADMIN_LOGIN_RATE_LIMIT: '8',
    ORACLESTREET_API_RATE_LIMIT: '120',
    ORACLESTREET_IMPORT_RATE_LIMIT: '6',
    ORACLESTREET_DRY_RUN_GLOBAL_RATE_LIMIT: '30',
    ORACLESTREET_DRY_RUN_DOMAIN_RATE_LIMIT: '5'
  }, async () => {
    const unauth = await request('/api/platform/rate-limit-readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/platform/rate-limit-readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'platform-rate-limit-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.limits.adminLoginPerWindow, 8);
    assert.equal(readiness.body.limits.apiPerWindow, 120);
    assert.equal(readiness.body.limits.importPerWindow, 6);
    assert.equal(readiness.body.limits.dryRunGlobalPerHour, 30);
    assert.equal(readiness.body.enforcement.dryRunQueue, 'implemented_per_window');
    assert.equal(readiness.body.enforcement.externalDelivery, 'locked');
    assert.equal(readiness.body.safety.noTrafficMutation, true);
    assert.equal(readiness.body.realDeliveryAllowed, false);
    assert.ok(readiness.body.protectedSurfaces.includes('admin_login'));

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'platform_rate_limit_readiness_view'));
  });
});

test('RBAC readiness endpoint requires admin and reports planned roles without mutation', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_MULTI_USER_ENABLED: 'false'
  }, async () => {
    const unauth = await request('/api/platform/rbac-readiness');
    assert.equal(unauth.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/platform/rbac-readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.mode, 'rbac-readiness-safe-gate');
    assert.equal(readiness.body.ok, true);
    assert.equal(readiness.body.currentAccess.model, 'single_admin_session');
    assert.equal(readiness.body.currentAccess.adminEmailDomain, 'example.test');
    assert.equal(readiness.body.currentAccess.multiUserEnabled, false);
    assert.equal(readiness.body.enforcement.current, 'admin_session_required_for_protected_routes');
    assert.equal(readiness.body.enforcement.multiUser, 'planned_locked');
    assert.ok(readiness.body.plannedRoles.some((role) => role.role === 'compliance'));
    assert.ok(readiness.body.protectedSurfaces.includes('readiness_gates'));
    assert.equal(readiness.body.safety.noUserMutation, true);
    assert.equal(readiness.body.safety.noRoleMutation, true);
    assert.equal(readiness.body.realDeliveryAllowed, false);

    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'rbac_readiness_view'));
  });
});

test('admin user directory and invite-plan workflow require admin and avoid secrets or mutation', async () => {
  resetAuditLogForTests();
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable'
  }, async () => {
    const unauthList = await request('/api/admin/users');
    assert.equal(unauthList.status, 401);
    const unauthInvite = await request('/api/admin/users/invite-plan', { method: 'POST' });
    assert.equal(unauthInvite.status, 401);

    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const users = await request('/api/admin/users', { headers: { cookie } });
    assert.equal(users.status, 200);
    assert.equal(users.body.mode, 'admin-user-directory');
    assert.equal(users.body.count, 1);
    assert.equal(users.body.users[0].email, 'admin@example.test');
    assert.ok(users.body.roleMatrix.some((role) => role.role === 'operator'));
    assert.equal(users.body.realDeliveryAllowed, false);
    assert.ok(!JSON.stringify(users.body).includes('correct-horse-battery-staple'));

    const rejected = await request('/api/admin/users/invite-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'bad-email', role: 'operator' })
    });
    assert.equal(rejected.status, 400);
    assert.ok(rejected.body.errors.includes('valid_user_email_required'));

    const planned = await request('/api/admin/users/invite-plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'operator@example.test', role: 'operator' })
    });
    assert.equal(planned.status, 200);
    assert.equal(planned.body.mode, 'admin-user-invite-plan');
    assert.equal(planned.body.invite.status, 'planned_not_sent');
    assert.equal(planned.body.invite.userMutation, false);
    assert.equal(planned.body.safety.noEmailSent, true);
    assert.equal(planned.body.safety.noTokenOutput, true);
    assert.equal(planned.body.invite.tokenDisplayed, false);
    assert.equal(planned.body.realDeliveryAllowed, false);
    assert.ok(!JSON.stringify(planned.body).includes('correct-horse-battery-staple'));

    const after = await request('/api/admin/users', { headers: { cookie } });
    assert.equal(after.body.count, users.body.count);
    const audit = await request('/api/audit-log', { headers: { cookie } });
    assert.ok(audit.body.events.some((event) => event.action === 'admin_user_directory_view'));
    assert.ok(audit.body.events.some((event) => event.action === 'admin_user_invite_plan'));
  });
});

test('sending readiness reports provider blockers without exposing secrets', async () => {
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable',
    ORACLESTREET_MAIL_PROVIDER: 'powermta',
    ORACLESTREET_REAL_EMAIL_ENABLED: 'true',
    ORACLESTREET_POWERMTA_HOST: 'pmta.example.test',
    ORACLESTREET_POWERMTA_USERNAME: 'pmta-user',
    ORACLESTREET_POWERMTA_PASSWORD: 'super-secret-value'
  }, async () => {
    const login = await loginAsAdmin();
    const cookie = login.headers.get('set-cookie');
    const readiness = await request('/api/email/sending-readiness', { headers: { cookie } });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.provider.provider, 'powermta');
    assert.equal(readiness.body.requiredGates.nonDryRunProviderSelected, true);
    assert.equal(readiness.body.requiredGates.realSendingFlagEnabled, true);
    assert.equal(readiness.body.readyForRealDelivery, false);
    assert.ok(readiness.body.blockers.includes('provider_config_invalid'));
    assert.ok(!JSON.stringify(readiness.body).includes('super-secret-value'));
  });
});

test('sending readiness endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/email/sending-readiness');
  assert.equal(res.status, 401);
  const controlledLiveTest = await request('/email/controlled-live-test/readiness');
  assert.equal(controlledLiveTest.status, 401);
  const domain = await request('/email/domain-readiness');
  assert.equal(domain.status, 401);
  const webDomain = await request('/web/domain-readiness');
  assert.equal(webDomain.status, 401);
  const webTls = await request('/web/tls-readiness');
  assert.equal(webTls.status, 401);
  const backups = await request('/backups/readiness');
  assert.equal(backups.status, 401);
  const monitoring = await request('/monitoring/readiness');
  assert.equal(monitoring.status, 401);
  const platformRateLimits = await request('/platform/rate-limit-readiness');
  assert.equal(platformRateLimits.status, 401);
  const rbac = await request('/platform/rbac-readiness');
  assert.equal(rbac.status, 401);
});
