import crypto from 'node:crypto';
import { listAuditLog, recordAuditEvent } from './lib/auditLog.js';
import { approveCampaignDryRun, createCampaign, enqueueCampaignDryRun, estimateCampaign, listCampaigns, scheduleCampaignDryRun } from './lib/campaigns.js';
import { importContacts, listContacts, validateContactImport } from './lib/contacts.js';
import { validateDatabaseConfig } from './lib/database.js';
import { createDataSource, createDataSourceSyncRun, listDataSources, listDataSourceSyncRuns } from './lib/dataSources.js';
import { senderDomainReadiness } from './lib/domainReadiness.js';
import { ingestEmailEvents, listEmailEvents, recordEmailEvent, recordTrackingEvent } from './lib/emailEvents.js';
import { validateEventImportCsv } from './lib/eventImport.js';
import { dryRunSend, getEmailProviderConfig, getProviderAdapter, listLocalCapture, validatePowerMtaConfig, validateSelectedProviderConfig } from './lib/emailProvider.js';
import { listMigrations } from './lib/migrations.js';
import { getRateLimitConfig } from './lib/rateLimits.js';
import { campaignReportingSummary, emailReportingSummary, sendingReadinessSummary } from './lib/reporting.js';
import { createSegment, estimateSegmentAudience, listSegments } from './lib/segments.js';
import { dispatchNextDryRunJob, enqueueDryRunSend, listSendQueue } from './lib/sendQueue.js';
import { addSuppression, listSuppressions, recordUnsubscribe } from './lib/suppressions.js';
import { createTemplate, listTemplates, renderTemplatePreview } from './lib/templates.js';

const SESSION_COOKIE = 'oraclestreet_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

const jsonResponse = (res, status, payload, headers = {}) => {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
};

const base64url = (value) => Buffer.from(value).toString('base64url');
const unbase64url = (value) => Buffer.from(value, 'base64url').toString('utf8');

const sessionSecret = () => process.env.ORACLESTREET_SESSION_SECRET || 'oraclestreet-dev-session-secret-change-me';

const sign = (payload) =>
  crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');

const safeEqual = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const createSessionToken = (email) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ email, iat: now, exp: now + SESSION_TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
};

const parseCookies = (header = '') => Object.fromEntries(
  header
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf('=');
      if (index === -1) return [entry, ''];
      return [entry.slice(0, index), decodeURIComponent(entry.slice(index + 1))];
    })
);

const getSession = (req) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(unbase64url(payload));
    if (!session.email || !session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: session.email, expiresAt: new Date(session.exp * 1000).toISOString() };
  } catch {
    return null;
  }
};

const adminEmail = () => process.env.ORACLESTREET_ADMIN_EMAIL || 'admin@oraclestreet.local';
const adminPassword = () => process.env.ORACLESTREET_ADMIN_PASSWORD;

const requireMethod = (req, res, method) => {
  if (req.method === method) return true;
  jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: method });
  return false;
};

const requireSession = (req, res) => {
  const session = getSession(req);
  if (!session) {
    jsonResponse(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  return session;
};

const dashboardSummary = (session) => {
  const emailReporting = emailReportingSummary();
  const campaignReporting = campaignReportingSummary();
  const contactList = listContacts();
  const segmentList = listSegments();
  const templateList = listTemplates();
  const campaignList = listCampaigns();
  const campaignEngagement = campaignReporting.campaigns.reduce((totals, campaign) => {
    totals.opens += campaign.engagement?.opens || 0;
    totals.clicks += campaign.engagement?.clicks || 0;
    totals.denominator += campaign.engagement?.denominator || 0;
    return totals;
  }, { opens: 0, clicks: 0, denominator: 0 });
  return {
    ok: true,
    user: { email: session.email },
    summary: {
      contacts: contactList.count,
      segments: segmentList.count,
      templates: templateList.count,
      campaigns: campaignList.count,
      queuedSends: emailReporting.totals.queuedDryRuns,
      suppressions: emailReporting.totals.suppressions,
      emailEvents: emailReporting.totals.emailEvents,
      auditEvents: emailReporting.totals.auditEvents,
      bounces: emailReporting.totals.bounces,
      complaints: emailReporting.totals.complaints,
      opens: emailReporting.totals.opens,
      clicks: emailReporting.totals.clicks,
      campaignOpenRate: campaignEngagement.denominator > 0 ? campaignEngagement.opens / campaignEngagement.denominator : 0,
      campaignClickRate: campaignEngagement.denominator > 0 ? campaignEngagement.clicks / campaignEngagement.denominator : 0,
      emailProvider: emailReporting.provider.provider,
      sendMode: emailReporting.provider.sendMode
    },
    emailReporting,
    campaignReporting,
    safetyGates: {
      consentTracking: 'baseline-enforced',
      suppressions: 'baseline-enforced',
      unsubscribe: 'baseline-recorded',
      engagementTracking: 'dry-run-events-only',
      bounceComplaints: 'manual-ingest-baseline',
      rateLimits: 'dry-run-warmup-baseline',
      auditLogs: 'baseline-in-memory',
      realSendingAllowed: false
    }
  };
};

export const createHandler = () => {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return jsonResponse(res, 200, {
        ok: true,
        service: 'oraclestreet-backend',
        scope: 'affiliate-email-cms',
        emailProvider: process.env.ORACLESTREET_MAIL_PROVIDER || 'dry-run',
        auth: 'admin-session',
        time: new Date().toISOString()
      });
    }

    if (url.pathname === '/api/data-sources' || url.pathname === '/data-sources') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') {
        recordAuditEvent({ action: 'data_sources_list', actorEmail: session.email, details: { realSync: false } });
        return jsonResponse(res, 200, listDataSources());
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
        const result = createDataSource({ ...body, actorEmail: session.email });
        recordAuditEvent({ action: 'data_source_create', actorEmail: session.email, target: result.source?.id || body.name || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], realSync: false } });
        return jsonResponse(res, result.ok ? 200 : 400, result);
      }
      return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
    }

    if (url.pathname === '/api/data-source-sync-runs' || url.pathname === '/data-source-sync-runs') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') {
        recordAuditEvent({ action: 'data_source_sync_runs_list', actorEmail: session.email, details: { realSync: false } });
        return jsonResponse(res, 200, listDataSourceSyncRuns());
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
        const result = createDataSourceSyncRun({ ...body, actorEmail: session.email });
        recordAuditEvent({ action: 'data_source_sync_dry_run', actorEmail: session.email, target: body.dataSourceId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], rowsPulled: 0, realSync: false } });
        return jsonResponse(res, result.ok ? 200 : 400, result);
      }
      return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
    }

    if (url.pathname === '/api/email/config' || url.pathname === '/email/config') {
      const config = getEmailProviderConfig();
      return jsonResponse(res, 200, {
        ok: true,
        ...config,
        powerMtaValidation: validatePowerMtaConfig()
      });
    }

    if (url.pathname === '/api/auth/session' || url.pathname === '/auth/session') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = getSession(req);
      return jsonResponse(res, 200, { ok: true, authenticated: Boolean(session), user: session ? { email: session.email } : null, expiresAt: session?.expiresAt || null });
    }

    if (url.pathname === '/api/auth/login' || url.pathname === '/auth/login') {
      if (!requireMethod(req, res, 'POST')) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      if (!adminPassword()) return jsonResponse(res, 503, { ok: false, error: 'admin_not_bootstrapped' });
      if (body.email !== adminEmail() || body.password !== adminPassword()) {
        recordAuditEvent({ action: 'admin_login', actorEmail: body.email || null, status: 'rejected', details: { reason: 'invalid_credentials' } });
        return jsonResponse(res, 401, { ok: false, error: 'invalid_credentials' });
      }
      recordAuditEvent({ action: 'admin_login', actorEmail: adminEmail(), status: 'ok' });
      const token = createSessionToken(adminEmail());
      return jsonResponse(res, 200, { ok: true, user: { email: adminEmail() } }, {
        'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
      });
    }

    if (url.pathname === '/api/auth/logout' || url.pathname === '/auth/logout') {
      if (!requireMethod(req, res, 'POST')) return;
      return jsonResponse(res, 200, { ok: true }, {
        'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
      });
    }

    if (url.pathname === '/api/dashboard' || url.pathname === '/dashboard') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, dashboardSummary(session));
    }

    if (url.pathname === '/api/email/reporting' || url.pathname === '/email/reporting') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, emailReportingSummary());
    }

    if (url.pathname === '/api/email/sending-readiness' || url.pathname === '/email/sending-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = sendingReadinessSummary();
      recordAuditEvent({ action: 'email_sending_readiness_view', actorEmail: session.email, target: readiness.provider.provider, details: { readyForRealDelivery: readiness.readyForRealDelivery, blockers: readiness.blockers } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/email/domain-readiness' || url.pathname === '/email/domain-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = senderDomainReadiness();
      recordAuditEvent({ action: 'email_domain_readiness_view', actorEmail: session.email, target: readiness.senderDomain || readiness.primaryDomain, status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/schema/migrations' || url.pathname === '/schema/migrations') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, { ok: true, migrations: listMigrations() });
    }

    if (url.pathname === '/api/database/status' || url.pathname === '/database/status') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const database = validateDatabaseConfig();
      recordAuditEvent({ action: 'database_status_view', actorEmail: session.email, target: 'database', details: { ok: database.ok, source: database.config.source } });
      return jsonResponse(res, 200, { ok: true, database });
    }

    if (url.pathname === '/api/audit-log' || url.pathname === '/audit-log') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, listAuditLog());
    }

    if (url.pathname === '/api/contacts' || url.pathname === '/contacts') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, listContacts());
    }

    if (url.pathname === '/api/contacts/import/validate' || url.pathname === '/contacts/import/validate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = validateContactImport(body.contacts);
      recordAuditEvent({ action: 'contact_import_validate', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { acceptedCount: result.acceptedCount, rejectedCount: result.rejectedCount } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/contacts/import' || url.pathname === '/contacts/import') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = importContacts(body.contacts, session.email);
      recordAuditEvent({ action: 'contact_import', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { importedCount: result.importedCount, updatedCount: result.updatedCount, rejectedCount: result.rejectedCount, error: result.error } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/segments' || url.pathname === '/segments') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') return jsonResponse(res, 200, listSegments());
      if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = createSegment({ name: body.name, criteria: body.criteria, actorEmail: session.email });
      recordAuditEvent({ action: 'segment_create', actorEmail: session.email, target: body.name || null, status: result.ok ? 'ok' : 'rejected', details: { estimatedAudience: result.segment?.estimatedAudience, errors: result.errors || [] } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/segments/estimate' || url.pathname === '/segments/estimate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = estimateSegmentAudience(body.criteria || {});
      recordAuditEvent({ action: 'segment_estimate', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { estimatedAudience: result.estimatedAudience, errors: result.errors || [] } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/templates' || url.pathname === '/templates') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') return jsonResponse(res, 200, listTemplates());
      if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = createTemplate({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'template_create', actorEmail: session.email, target: body.name || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [] } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/templates/preview' || url.pathname === '/templates/preview') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = renderTemplatePreview({ id: body.id, data: body.data || {} });
      recordAuditEvent({ action: 'template_preview', actorEmail: session.email, target: body.id || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/campaigns' || url.pathname === '/campaigns') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') return jsonResponse(res, 200, listCampaigns());
      if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = createCampaign({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'campaign_create', actorEmail: session.email, target: body.name || null, status: result.ok ? 'ok' : 'rejected', details: { estimatedAudience: result.campaign?.estimatedAudience, suppressedCount: result.campaign?.suppressedCount, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/campaigns/estimate' || url.pathname === '/campaigns/estimate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = estimateCampaign({ segmentId: body.segmentId, templateId: body.templateId });
      recordAuditEvent({ action: 'campaign_estimate', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { estimatedAudience: result.estimatedAudience, suppressedCount: result.suppressedCount, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/campaigns/approve-dry-run' || url.pathname === '/campaigns/approve-dry-run') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = approveCampaignDryRun({ campaignId: body.campaignId, actorEmail: session.email });
      recordAuditEvent({ action: 'campaign_approve_dry_run', actorEmail: session.email, target: body.campaignId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/campaigns/schedule-dry-run' || url.pathname === '/campaigns/schedule-dry-run') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = scheduleCampaignDryRun({ campaignId: body.campaignId, scheduledAt: body.scheduledAt, actorEmail: session.email });
      recordAuditEvent({ action: 'campaign_schedule_dry_run', actorEmail: session.email, target: body.campaignId || null, status: result.ok ? 'ok' : 'rejected', details: { scheduledAt: result.campaign?.scheduledAt || body.scheduledAt || null, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/campaigns/enqueue-dry-run' || url.pathname === '/campaigns/enqueue-dry-run') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = enqueueCampaignDryRun({ campaignId: body.campaignId, actorEmail: session.email });
      recordAuditEvent({ action: 'campaign_enqueue_dry_run', actorEmail: session.email, target: body.campaignId || null, status: result.ok ? 'ok' : 'rejected', details: { enqueuedCount: result.enqueuedCount, rejectedCount: result.rejectedCount, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/campaigns/reporting' || url.pathname === '/campaigns/reporting') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const report = campaignReportingSummary();
      recordAuditEvent({ action: 'campaign_reporting_view', actorEmail: session.email, details: { campaignCount: report.count, realDelivery: false } });
      return jsonResponse(res, 200, report);
    }

    if (url.pathname === '/api/email/test-send' || url.pathname === '/email/test-send') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = dryRunSend(body);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/email/provider/validate' || url.pathname === '/email/provider/validate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const validation = validateSelectedProviderConfig();
      recordAuditEvent({ action: 'email_provider_validate', actorEmail: session.email, target: validation.provider, status: validation.ok ? 'ok' : 'rejected', details: { errors: validation.errors } });
      return jsonResponse(res, 200, {
        ok: true,
        validation,
        safeDefault: 'network_probe_skipped_no_delivery'
      });
    }

    if (url.pathname === '/api/email/provider/adapter' || url.pathname === '/email/provider/adapter') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const adapter = getProviderAdapter();
      recordAuditEvent({ action: 'email_provider_adapter_view', actorEmail: session.email, target: adapter.name, details: { ok: adapter.ok, dispatchMode: adapter.capabilities.dispatchMode, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, adapter);
    }

    if (url.pathname === '/api/email/local-capture' || url.pathname === '/email/local-capture') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, listLocalCapture());
    }

    if (url.pathname === '/api/send-queue' || url.pathname === '/send-queue') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, listSendQueue());
    }

    if (url.pathname === '/api/email/rate-limits' || url.pathname === '/email/rate-limits') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, { ok: true, mode: 'dry-run-warmup', rateLimits: getRateLimitConfig() });
    }

    if (url.pathname === '/api/send-queue/dispatch-next-dry-run' || url.pathname === '/send-queue/dispatch-next-dry-run') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = dispatchNextDryRunJob({ actorEmail: session.email });
      const event = result.ok ? recordEmailEvent({ type: 'dispatched', email: result.job.to, source: 'send_queue_dry_run_dispatch', detail: result.job.id, campaignId: result.job.campaignId, contactId: result.job.contactId, actorEmail: session.email }) : null;
      recordAuditEvent({ action: 'send_queue_dispatch_dry_run', actorEmail: session.email, target: result.job?.id || null, status: result.ok ? 'ok' : 'rejected', details: { eventId: event?.event?.id || null, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result.ok ? { ...result, event: event?.event || null } : result);
    }

    if (url.pathname === '/api/send-queue/enqueue' || url.pathname === '/send-queue/enqueue') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = enqueueDryRunSend(body, session.email);
      recordAuditEvent({ action: 'send_queue_enqueue', actorEmail: session.email, target: body.to || null, status: result.ok ? 'ok' : 'rejected', details: { mode: result.mode, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/suppressions' || url.pathname === '/suppressions') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') return jsonResponse(res, 200, listSuppressions());
      if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = addSuppression({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'suppression_upsert', actorEmail: session.email, target: body.email || null, status: result.ok ? 'ok' : 'rejected', details: { reason: body.reason, errors: result.errors || [] } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/unsubscribe' || url.pathname === '/unsubscribe') {
      if (!['GET', 'POST'].includes(req.method)) return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
      const body = req.method === 'POST' ? await readJsonBody(req) : null;
      if (req.method === 'POST' && body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const payload = req.method === 'GET'
        ? {
            email: url.searchParams.get('email'),
            source: url.searchParams.get('source'),
            campaignId: url.searchParams.get('campaignId'),
            contactId: url.searchParams.get('contactId')
          }
        : body;
      const source = payload.source || (payload.campaignId ? `campaign:${payload.campaignId}` : 'unsubscribe_endpoint');
      const result = recordUnsubscribe({ email: payload.email, source });
      recordAuditEvent({ action: 'unsubscribe_record', actorEmail: null, target: payload.email || null, status: result.ok ? 'ok' : 'rejected', details: { source, campaignId: payload.campaignId || null, contactId: payload.contactId || null, method: req.method, errors: result.errors || [] } });
      return jsonResponse(res, result.ok ? 200 : 400, {
        ...result,
        mode: 'tracked-unsubscribe',
        campaignId: payload.campaignId || null,
        contactId: payload.contactId || null,
        realDelivery: false
      });
    }

    if (url.pathname === '/api/email/events' || url.pathname === '/email/events') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, listEmailEvents());
    }

    if (url.pathname === '/api/track/open' || url.pathname === '/track/open') {
      if (!requireMethod(req, res, 'GET')) return;
      const result = recordTrackingEvent({ type: 'open', email: url.searchParams.get('email'), campaignId: url.searchParams.get('campaignId'), contactId: url.searchParams.get('contactId'), detail: url.searchParams.get('detail') || null });
      recordAuditEvent({ action: 'email_tracking_open', target: url.searchParams.get('campaignId') || null, status: result.ok ? 'ok' : 'rejected', details: { email: url.searchParams.get('email') || null, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, { ...result, mode: 'tracked-open-event', realDelivery: false });
    }

    if (url.pathname === '/api/track/click' || url.pathname === '/track/click') {
      if (!requireMethod(req, res, 'GET')) return;
      const result = recordTrackingEvent({ type: 'click', email: url.searchParams.get('email'), campaignId: url.searchParams.get('campaignId'), contactId: url.searchParams.get('contactId'), detail: url.searchParams.get('url') || url.searchParams.get('detail') || null });
      recordAuditEvent({ action: 'email_tracking_click', target: url.searchParams.get('campaignId') || null, status: result.ok ? 'ok' : 'rejected', details: { email: url.searchParams.get('email') || null, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, { ...result, mode: 'tracked-click-event', redirect: false, realDelivery: false });
    }

    if (url.pathname === '/api/email/events/validate-import' || url.pathname === '/email/events/validate-import') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = validateEventImportCsv({ csv: body.csv });
      recordAuditEvent({ action: 'email_events_import_validate', actorEmail: session.email, status: result.ok ? 'ok' : 'partial_or_rejected', details: { acceptedCount: result.acceptedCount || 0, rejectedCount: result.rejectedCount || 0, error: result.error, realDelivery: false } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/email/events/import' || url.pathname === '/email/events/import') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const validation = validateEventImportCsv({ csv: body.csv });
      if (validation.error || !validation.ok) {
        recordAuditEvent({ action: 'email_events_import', actorEmail: session.email, status: 'rejected', details: { acceptedCount: validation.acceptedCount || 0, rejectedCount: validation.rejectedCount || 0, error: validation.error, realDelivery: false } });
        return jsonResponse(res, 400, { ...validation, imported: false, realDelivery: false });
      }
      const ingest = ingestEmailEvents({ events: validation.accepted.map((entry) => entry.event), actorEmail: session.email });
      const result = {
        ok: ingest.ok,
        mode: 'manual-event-import-ingest',
        validation,
        ingest,
        importedCount: ingest.acceptedCount,
        rejectedCount: ingest.rejectedCount,
        imported: ingest.ok,
        realDelivery: false
      };
      recordAuditEvent({ action: 'email_events_import', actorEmail: session.email, status: ingest.ok ? 'ok' : 'partial_or_rejected', details: { importedCount: result.importedCount, rejectedCount: result.rejectedCount, realDelivery: false } });
      return jsonResponse(res, ingest.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/email/events/ingest' || url.pathname === '/email/events/ingest') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = ingestEmailEvents({ events: body.events, actorEmail: session.email });
      recordAuditEvent({ action: 'email_events_ingest', actorEmail: session.email, status: result.ok ? 'ok' : 'partial_or_rejected', details: { acceptedCount: result.acceptedCount, rejectedCount: result.rejectedCount, error: result.error } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    return jsonResponse(res, 404, {
      ok: false,
      error: 'not_found',
      message: 'OracleStreet API baseline is running.'
    });
  };
};
