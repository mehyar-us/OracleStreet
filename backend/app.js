import crypto from 'node:crypto';
import { acceptAdminUserInvite, completePasswordReset, createAdminUserInvite, createPasswordResetPlan, getAdminUserRole, listAdminSessions, listAdminUsers, planAdminUserInvite, recordAdminSession, revokeAdminSession, revokeAdminSessionsForUser, roleHasPermission, updateAdminUserRole, upsertAdminUser, validateAdminSession, verifyAdminUserPassword } from './lib/adminUsers.js';
import { listAuditEventsByActionPrefix, listAuditLog, recordAuditEvent } from './lib/auditLog.js';
import { backupReadiness } from './lib/backupReadiness.js';
import { bounceMailboxReadiness } from './lib/bounceMailboxReadiness.js';
import { ingestBounceMessage, validateBounceMessage } from './lib/bounceParser.js';
import { campaignCalendar, campaignCalendarAllocation, campaignCalendarCapacityForecast, campaignCalendarDrilldown, campaignCalendarReschedulePlan, campaignCalendarWarmupBoard } from './lib/campaignCalendar.js';
import { approveCampaignDryRun, campaignAffiliateSummary, createCampaign, enqueueCampaignDryRun, estimateCampaign, listCampaigns, scheduleCampaignDryRun } from './lib/campaigns.js';
import { controlledLiveTestReadiness, listControlledLiveTestProofAudits, planControlledLiveTest, planControlledLiveTestProofPacket, planSeedInboxObservation, recordControlledLiveTestProofAudit } from './lib/controlledLiveTestReadiness.js';
import { browseContacts, contactAudienceExclusionPreview, contactAudienceReadinessReview, contactBrowserExportPreview, contactCampaignFitPlan, contactConsentProvenanceReview, contactDetailDrilldown, contactDomainRiskPlan, contactEngagementRecencyPlan, contactRepermissionPlan, contactRiskTriageQueue, contactSourceDetailReview, contactSourceQuarantinePlan, contactSuppressionReviewPlan, sourceHygieneActionPlan, sourceQualityDrilldown, sourceQualityMatrix } from './lib/contactBrowser.js';
import { importContacts, listContacts, validateContactImport } from './lib/contacts.js';
import { validateDatabaseConfig } from './lib/database.js';
import { auditDataSourceImportSchedules, createDataSource, createDataSourceImportSchedule, createDataSourceSyncRun, executeDataSourceQuery, executeDataSourceSchemaDiscovery, importContactsFromDataSource, listDataSources, listDataSourceImportSchedules, listDataSourceSyncRuns, planDataSourceImportScheduleRunbook, planDataSourceImportScheduleTimeline, planDataSourceImportScheduleWorker, planDataSourceSchemaDiscovery, previewContactImportFromDataSource, replayDataSourceSyncRun, updateDataSourceImportScheduleStatus, validateDataSourceQuery } from './lib/dataSources.js';
import { senderDomainReadiness } from './lib/domainReadiness.js';
import { findEmailEventsByProviderMessageId, ingestDeliveryEvents, ingestEmailEvents, listEmailEvents, recordEmailEvent, recordTrackingEvent } from './lib/emailEvents.js';
import { validateEventImportCsv } from './lib/eventImport.js';
import { dryRunSend, getEmailProviderConfig, getProviderAdapter, listLocalCapture, validatePowerMtaConfig, validateSelectedProviderConfig } from './lib/emailProvider.js';
import { buildContactDedupeMergePlan, buildListHygienePlan } from './lib/listHygiene.js';
import { listMigrations } from './lib/migrations.js';
import { monitoringReadiness } from './lib/monitoringReadiness.js';
import { mtaOperationsDashboard, providerReadinessDrilldown } from './lib/mtaOperations.js';
import { platformRateLimitReadiness } from './lib/platformRateLimits.js';
import { importPowerMtaAccountingCsv, validatePowerMtaAccountingCsv } from './lib/pmtaAccountingImport.js';
import { getRateLimitConfig } from './lib/rateLimits.js';
import { RBAC_ROUTE_POLICY, rbacEffectiveAccess, rbacReadiness } from './lib/rbacReadiness.js';
import { repositoryReadiness } from './lib/repositoryReadiness.js';
import { evaluateAutoPause, evaluateDomainReputationRollup, getReputationPolicy, saveReputationPolicy } from './lib/reputationControls.js';
import { planWarmupSchedule } from './lib/warmupPlans.js';
import { evaluateWarmupScheduleCap, listWarmupPolicies, saveWarmupPolicy } from './lib/warmupPolicies.js';
import { campaignReportingSummary, emailReportingSummary, reportingDashboardDepth, reportingDashboardDrilldown, reportingDeliverabilityAudit, reportingExportPreview, sendingReadinessSummary } from './lib/reporting.js';
import { createSegment, createSegmentSnapshot, estimateSegmentAudience, listSegmentSnapshots, listSegments } from './lib/segments.js';
import { sendQueueReadiness } from './lib/sendQueueReadiness.js';
import { dispatchNextDryRunJob, enqueueDryRunSend, listSendQueue } from './lib/sendQueue.js';
import { addSuppression, listSuppressions, recordUnsubscribe } from './lib/suppressions.js';
import { createTemplate, listTemplates, renderTemplatePreview } from './lib/templates.js';
import { webDomainReadiness, webTlsReadiness } from './lib/webReadiness.js';

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
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const ledger = validateAdminSession({ token, email: session.email });
    if (!ledger.ok) return null;
    return { email: session.email, expiresAt: new Date(session.exp * 1000).toISOString(), sessionPersistenceMode: ledger.persistenceMode || null };
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
  const role = getAdminUserRole(session.email) || 'read_only';
  return { ...session, role, permissions: [] };
};

const requirePermission = (req, res, permission) => {
  const session = requireSession(req, res);
  if (!session) return null;
  if (!roleHasPermission(session.role, permission)) {
    recordAuditEvent({ action: 'rbac_permission_denied', actorEmail: session.email, target: permission, status: 'rejected', details: { role: session.role, path: req.url, noUserMutation: true, realDeliveryAllowed: false } });
    jsonResponse(res, 403, { ok: false, error: 'forbidden', requiredPermission: permission, role: session.role, realDeliveryAllowed: false });
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
  const dataSourceList = listDataSources();
  const dataSourceSyncRunList = listDataSourceSyncRuns();
  const listHygiene = buildListHygienePlan();
  const reputationAutoPause = evaluateAutoPause();
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
      dataSources: dataSourceList.count,
      dataSourceSyncRuns: dataSourceSyncRunList.count,
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
      hygieneRiskContacts: listHygiene.totals.riskyContacts,
      hygieneCleanupActions: listHygiene.recommendations.length,
      reputationRecommendPause: reputationAutoPause.recommendPause,
      reputationBreaches: reputationAutoPause.thresholdBreaches.length,
      emailProvider: emailReporting.provider.provider,
      sendMode: emailReporting.provider.sendMode
    },
    emailReporting,
    campaignReporting,
    dataSourceReporting: {
      mode: 'data-source-mapping-ui-safe-baseline',
      dataSources: dataSourceList.count,
      syncRuns: dataSourceSyncRunList.count,
      latestSyncRun: dataSourceSyncRunList.runs[0] || null,
      mappingUi: 'safe-validation-only',
      realSync: false
    },
    listHygiene: {
      mode: listHygiene.mode,
      totals: listHygiene.totals,
      recommendations: listHygiene.recommendations.slice(0, 5),
      cleanupMutation: false,
      realDeliveryAllowed: false
    },
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
      const session = req.method === 'POST' ? requirePermission(req, res, 'manage_data_sources') : requireSession(req, res);
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

    if (url.pathname === '/api/data-source-sync-runs/replay' || url.pathname === '/data-source-sync-runs/replay') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_data_sources');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = replayDataSourceSyncRun({ runId: body.runId, actorEmail: session.email });
      recordAuditEvent({ action: 'data_source_sync_run_replay', actorEmail: session.email, target: body.runId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], replayOf: result.replayOf || body.runId || null, rowsPulled: 0, realSync: false, replayMutation: Boolean(result.replayMutation) } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/data-source-import-schedules' || url.pathname === '/data-source-import-schedules') {
      const session = req.method === 'POST' ? requirePermission(req, res, 'manage_data_sources') : requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') {
        const result = listDataSourceImportSchedules();
        recordAuditEvent({ action: 'data_source_import_schedules_list', actorEmail: session.email, details: { count: result.count, realSync: false, automaticPulls: false } });
        return jsonResponse(res, 200, result);
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
        const result = createDataSourceImportSchedule({ ...body, actorEmail: session.email });
        recordAuditEvent({ action: 'data_source_import_schedule_plan', actorEmail: session.email, target: body.dataSourceId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], scheduleMutation: Boolean(result.scheduleMutation), enabled: Boolean(result.schedule?.enabled), realSync: false, automaticPulls: false } });
        return jsonResponse(res, result.ok ? 200 : 400, result);
      }
      return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
    }

    if (url.pathname === '/api/data-source-import-schedules/status' || url.pathname === '/data-source-import-schedules/status') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_data_sources');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = updateDataSourceImportScheduleStatus({ scheduleId: body.scheduleId, enabled: body.enabled, approvalPhrase: body.approvalPhrase, actorEmail: session.email });
      recordAuditEvent({ action: 'data_source_import_schedule_status_update', actorEmail: session.email, target: body.scheduleId || null, status: result.ok ? 'ok' : 'rejected', details: { enabled: Boolean(result.schedule?.enabled), errors: result.errors || [], scheduleMutation: Boolean(result.scheduleMutation), noWorkerStarted: true, noRemoteConnectionOpened: true, rowsPulled: 0, contactsMutated: 0, realDeliveryAllowed: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/data-source-import-schedules/worker-plan' || url.pathname === '/data-source-import-schedules/worker-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requirePermission(req, res, 'manage_data_sources');
      if (!session) return;
      const result = planDataSourceImportScheduleWorker();
      recordAuditEvent({ action: 'data_source_import_schedule_worker_plan_view', actorEmail: session.email, status: 'ok', details: { dueSchedules: result.counts.dueSchedules, enabledSchedules: result.counts.enabledSchedules, noWorkerStarted: true, noRemoteConnectionOpened: true, noContactMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/data-source-import-schedules/timeline' || url.pathname === '/data-source-import-schedules/timeline') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requirePermission(req, res, 'manage_data_sources');
      if (!session) return;
      const result = planDataSourceImportScheduleTimeline({ days: url.searchParams.get('days') || 7 });
      recordAuditEvent({ action: 'data_source_import_schedule_timeline_view', actorEmail: session.email, status: 'ok', details: { horizonDays: result.horizonDays, forecastedRuns: result.totals.forecastedRuns, noWorkerStarted: true, noRemoteConnectionOpened: true, rowsPulled: 0, contactsMutated: 0, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/data-source-import-schedules/runbook' || url.pathname === '/data-source-import-schedules/runbook') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requirePermission(req, res, 'manage_data_sources');
      if (!session) return;
      const result = planDataSourceImportScheduleRunbook({ scheduleId: url.searchParams.get('scheduleId') || '' });
      recordAuditEvent({ action: 'data_source_import_schedule_runbook_view', actorEmail: session.email, target: result.schedule?.id || url.searchParams.get('scheduleId') || null, status: result.ok ? 'ok' : 'rejected', details: { error: result.error || null, runnableNow: false, noWorkerStarted: true, noRemoteConnectionOpened: true, rowsPulled: 0, contactsMutated: 0, realDeliveryAllowed: false } });
      return jsonResponse(res, result.ok ? 200 : 404, result);
    }

    if (url.pathname === '/api/data-source-import-schedules/audit' || url.pathname === '/data-source-import-schedules/audit') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requirePermission(req, res, 'manage_data_sources');
      if (!session) return;
      const result = auditDataSourceImportSchedules();
      recordAuditEvent({ action: 'data_source_import_schedule_audit_view', actorEmail: session.email, status: 'ok', details: { schedules: result.totals.schedules, dueSchedules: result.totals.dueSchedules, blockedSchedules: result.totals.blockedSchedules, noWorkerStarted: true, noRemoteConnectionOpened: true, rowsPulled: 0, contactsMutated: 0, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/data-source-sync-audit' || url.pathname === '/data-source-sync-audit') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const audit = listAuditEventsByActionPrefix('data_source_sync');
      recordAuditEvent({ action: 'data_source_sync_audit_view', actorEmail: session.email, details: { count: audit.count, realSync: false } });
      return jsonResponse(res, 200, { ...audit, mode: 'data-source-sync-audit-baseline', realSync: false });
    }

    if (url.pathname === '/api/data-source-import/preview' || url.pathname === '/data-source-import/preview') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = previewContactImportFromDataSource({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'data_source_contact_import_preview', actorEmail: session.email, target: body.dataSourceId || null, status: result.previewOk ? 'ok' : 'rejected', details: { errors: result.errors || [], rowsSeen: result.rowsSeen || 0, acceptedCount: result.acceptedCount || 0, rejectedCount: result.rejectedCount || 0, importMutation: false, realQuery: Boolean(result.realQuery) } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/data-source-import/execute' || url.pathname === '/data-source-import/execute') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = importContactsFromDataSource({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'data_source_contact_import_execute', actorEmail: session.email, target: body.dataSourceId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], rowsSeen: result.rowsSeen || 0, importedCount: result.importedCount || 0, updatedCount: result.updatedCount || 0, importMutation: Boolean(result.importMutation), realQuery: Boolean(result.realQuery), realDeliveryAllowed: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/data-source-query/validate' || url.pathname === '/data-source-query/validate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = validateDataSourceQuery({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'data_source_query_validate', actorEmail: session.email, target: body.dataSourceId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], rowsPulled: 0, realQuery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/data-source-schema/plan' || url.pathname === '/data-source-schema/plan') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = planDataSourceSchemaDiscovery({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'data_source_schema_plan', actorEmail: session.email, target: body.dataSourceId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], tablesReturned: 0, columnsReturned: 0, realDiscovery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/data-source-query/execute' || url.pathname === '/data-source-query/execute') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = executeDataSourceQuery({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'data_source_query_execute', actorEmail: session.email, target: body.dataSourceId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], rowsPulled: result.rowsPulled || 0, realQuery: Boolean(result.realQuery), redactedErrors: true } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/data-source-schema/discover' || url.pathname === '/data-source-schema/discover') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = executeDataSourceSchemaDiscovery({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'data_source_schema_discover', actorEmail: session.email, target: body.dataSourceId || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], tablesReturned: result.tablesReturned || 0, columnsReturned: result.columnsReturned || 0, realDiscovery: Boolean(result.realDiscovery), redactedErrors: true } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
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
      const cleanEmail = String(body.email || '').trim().toLowerCase();
      const bootstrapLogin = cleanEmail === String(adminEmail()).trim().toLowerCase() && body.password === adminPassword();
      const userLogin = bootstrapLogin ? { ok: false } : verifyAdminUserPassword({ email: cleanEmail, password: body.password });
      if (!adminPassword() && !userLogin.ok) return jsonResponse(res, 503, { ok: false, error: 'admin_not_bootstrapped' });
      if (!bootstrapLogin && !userLogin.ok) {
        recordAuditEvent({ action: 'admin_login', actorEmail: body.email || null, status: 'rejected', details: { reason: 'invalid_credentials' } });
        return jsonResponse(res, 401, { ok: false, error: 'invalid_credentials' });
      }
      const loginEmail = bootstrapLogin ? adminEmail() : cleanEmail;
      const userPersistence = bootstrapLogin ? upsertAdminUser({ email: adminEmail(), role: process.env.ORACLESTREET_BOOTSTRAP_ADMIN_ROLE || 'admin' }) : { persistenceMode: 'postgresql-local-psql-repository' };
      recordAuditEvent({ action: 'admin_login', actorEmail: loginEmail, status: 'ok', details: { userPersistenceMode: userPersistence.persistenceMode, passwordRepositoryLogin: !bootstrapLogin } });
      const token = createSessionToken(loginEmail);
      const expiresAt = new Date((Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS) * 1000).toISOString();
      const sessionPersistence = recordAdminSession({ token, email: loginEmail, expiresAt });
      return jsonResponse(res, 200, { ok: true, user: { email: loginEmail }, persistence: { user: userPersistence.persistenceMode, session: sessionPersistence.persistenceMode } }, {
        'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
      });
    }

    if (url.pathname === '/api/auth/logout' || url.pathname === '/auth/logout') {
      if (!requireMethod(req, res, 'POST')) return;
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const session = getSession(req);
      const sessionPersistence = token ? revokeAdminSession(token) : null;
      if (session) recordAuditEvent({ action: 'admin_logout', actorEmail: session.email, status: 'ok', details: { sessionPersistenceMode: sessionPersistence?.persistenceMode || null } });
      return jsonResponse(res, 200, { ok: true, persistence: { session: sessionPersistence?.persistenceMode || null } }, {
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

    if (url.pathname === '/api/email/reporting/dashboard' || url.pathname === '/email/reporting/dashboard') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = reportingDashboardDepth();
      recordAuditEvent({ action: 'reporting_dashboard_depth_view', actorEmail: session.email, status: 'ok', details: { campaigns: result.campaignLeaderboard.length, sources: result.sourcePerformance.length, domains: result.domainPerformance.length, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/email/reporting/drilldown' || url.pathname === '/email/reporting/drilldown') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = reportingDashboardDrilldown(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'reporting_dashboard_drilldown_view', actorEmail: session.email, target: `${result.dimension}:${result.key || 'none'}`, status: 'ok', details: { dimension: result.dimension, key: result.key, events: result.counts.events, contacts: result.counts.contacts, aggregateOnly: true, noQueueMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/email/reporting/deliverability-audit' || url.pathname === '/email/reporting/deliverability-audit') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = reportingDeliverabilityAudit();
      recordAuditEvent({ action: 'reporting_deliverability_audit_view', actorEmail: session.email, status: 'ok', details: { highRiskSources: result.totals.highRiskSources, highRiskDomains: result.totals.highRiskDomains, highRiskCampaigns: result.totals.highRiskCampaigns, aggregateOnly: true, noQueueMutation: true, noProviderMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/email/reporting/export' || url.pathname === '/email/reporting/export') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = reportingExportPreview({ dataset: url.searchParams.get('dataset') || 'campaigns', actorEmail: session.email });
      recordAuditEvent({ action: 'reporting_export_preview', actorEmail: session.email, target: result.dataset || url.searchParams.get('dataset') || null, status: result.ok ? 'ok' : 'rejected', details: { rowsExported: result.rowsExported || 0, format: result.format || 'csv', errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/email/sending-readiness' || url.pathname === '/email/sending-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = sendingReadinessSummary();
      recordAuditEvent({ action: 'email_sending_readiness_view', actorEmail: session.email, target: readiness.provider.provider, details: { readyForRealDelivery: readiness.readyForRealDelivery, blockers: readiness.blockers } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/email/mta-operations' || url.pathname === '/email/mta-operations') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const dashboard = mtaOperationsDashboard();
      recordAuditEvent({ action: 'mta_operations_dashboard_view', actorEmail: session.email, target: 'mta-reputation', status: 'ok', details: { provider: dashboard.provider.name, queuedDryRuns: dashboard.queue.queuedDryRuns, operationalBlockers: dashboard.readiness.operationalBlockers, noQueueMutation: true, noProviderMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, dashboard);
    }

    if (url.pathname === '/api/email/provider/readiness-drilldown' || url.pathname === '/email/provider/readiness-drilldown') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const drilldown = providerReadinessDrilldown();
      recordAuditEvent({ action: 'provider_readiness_drilldown_view', actorEmail: session.email, target: drilldown.selectedProvider, status: 'ok', details: { selectedDispatchMode: drilldown.selectedDispatchMode, blockers: drilldown.blockers, noProviderMutation: true, noQueueMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, drilldown);
    }

    if (url.pathname === '/api/email/controlled-live-test/readiness' || url.pathname === '/email/controlled-live-test/readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = controlledLiveTestReadiness();
      recordAuditEvent({ action: 'email_controlled_live_test_readiness_view', actorEmail: session.email, target: 'controlled-live-test', status: readiness.ok ? 'ok' : 'blocked', details: { blockers: readiness.blockers, noSend: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/email/controlled-live-test/plan' || url.pathname === '/email/controlled-live-test/plan') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = planControlledLiveTest({ ...body, actorEmail: session.email });
      recordAuditEvent({ action: 'email_controlled_live_test_plan', actorEmail: session.email, target: 'controlled-live-test', status: result.ok ? 'ok' : 'rejected', details: { blockers: result.blockers, noSend: true, noProviderMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/email/controlled-live-test/proof-audit' || url.pathname === '/email/controlled-live-test/proof-audit') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') {
        const result = listControlledLiveTestProofAudits();
        recordAuditEvent({ action: 'email_controlled_live_test_proof_audit_list', actorEmail: session.email, target: 'controlled-live-test', status: 'ok', details: { count: result.count, noSend: true, realDeliveryAllowed: false } });
        return jsonResponse(res, 200, result);
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
        const result = recordControlledLiveTestProofAudit({ ...body, actorEmail: session.email });
        recordAuditEvent({ action: 'email_controlled_live_test_proof_audit_record', actorEmail: session.email, target: 'controlled-live-test', status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], outcome: result.record?.outcome || body.outcome || null, noSend: true, noNetworkProbe: true, realDeliveryAllowed: false } });
        return jsonResponse(res, result.ok ? 200 : 400, result);
      }
      return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
    }

    if (url.pathname === '/api/email/controlled-live-test/seed-observation' || url.pathname === '/email/controlled-live-test/seed-observation') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = planSeedInboxObservation();
      recordAuditEvent({ action: 'email_seed_inbox_observation_plan_view', actorEmail: session.email, target: 'controlled-live-test', status: 'ok', details: { proofAudits: result.counts.proofAudits, observedOutcomes: result.counts.observedOutcomes, noMailboxConnection: true, noSend: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/email/controlled-live-test/proof-packet' || url.pathname === '/email/controlled-live-test/proof-packet') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = planControlledLiveTestProofPacket();
      recordAuditEvent({ action: 'email_controlled_live_test_proof_packet_view', actorEmail: session.email, target: 'controlled-live-test', status: result.proofGaps.length ? 'incomplete' : 'ok', details: { proofGaps: result.proofGaps, proofAuditCount: result.evidence.proofAuditCount, noSend: true, noNetworkProbe: true, noQueueMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/email/domain-readiness' || url.pathname === '/email/domain-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = senderDomainReadiness();
      recordAuditEvent({ action: 'email_domain_readiness_view', actorEmail: session.email, target: readiness.senderDomain || readiness.primaryDomain, status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/web/domain-readiness' || url.pathname === '/web/domain-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = webDomainReadiness();
      recordAuditEvent({ action: 'web_domain_readiness_view', actorEmail: session.email, target: readiness.primaryDomain, status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, tlsMode: readiness.tls.mode, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/web/tls-readiness' || url.pathname === '/web/tls-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = webTlsReadiness();
      recordAuditEvent({ action: 'web_tls_readiness_view', actorEmail: session.email, target: readiness.primaryDomain, status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, tlsMode: readiness.tlsMode, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/backups/readiness' || url.pathname === '/backups/readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = backupReadiness();
      recordAuditEvent({ action: 'backup_readiness_view', actorEmail: session.email, target: readiness.storage.path, status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, retentionDays: readiness.schedule.retentionDays, noDumpCreated: true } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/monitoring/readiness' || url.pathname === '/monitoring/readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = monitoringReadiness();
      recordAuditEvent({ action: 'monitoring_readiness_view', actorEmail: session.email, target: readiness.endpoints.primaryHealth, status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, intervalSeconds: readiness.schedule.intervalSeconds, noNetworkProbe: true } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/platform/rate-limit-readiness' || url.pathname === '/platform/rate-limit-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = platformRateLimitReadiness();
      recordAuditEvent({ action: 'platform_rate_limit_readiness_view', actorEmail: session.email, target: 'platform-rate-limits', status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/platform/rbac-readiness' || url.pathname === '/platform/rbac-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = rbacReadiness();
      recordAuditEvent({ action: 'rbac_readiness_view', actorEmail: session.email, target: readiness.currentAccess.adminEmailDomain, status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, noUserMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/platform/rbac-policy' || url.pathname === '/platform/rbac-policy') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = { ok: true, mode: 'rbac-route-permission-policy', currentUser: { email: session.email, role: session.role }, routePolicy: RBAC_ROUTE_POLICY, safety: { noUserMutation: true, noRoleMutation: true, noSecretOutput: true, realDeliveryAllowed: false }, realDeliveryAllowed: false };
      recordAuditEvent({ action: 'rbac_policy_view', actorEmail: session.email, target: session.role, status: 'ok', details: { routePolicies: RBAC_ROUTE_POLICY.length, noUserMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/platform/rbac-effective-access' || url.pathname === '/platform/rbac-effective-access') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requirePermission(req, res, 'manage_users');
      if (!session) return;
      const result = rbacEffectiveAccess({ currentEmail: session.email, currentRole: session.role });
      recordAuditEvent({ action: 'rbac_effective_access_review', actorEmail: session.email, target: session.role, status: 'ok', details: { usersReviewed: result.totals.usersReviewed, rolesReviewed: result.totals.rolesReviewed, routeSurfaces: result.totals.routeSurfaces, noUserMutation: true, noRoleMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/admin/users' || url.pathname === '/admin/users') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requirePermission(req, res, 'manage_users');
      if (!session) return;
      const result = listAdminUsers();
      recordAuditEvent({ action: 'admin_user_directory_view', actorEmail: session.email, status: 'ok', details: { count: result.count, role: session.role, noSecretOutput: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/admin/sessions' || url.pathname === '/admin/sessions') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requirePermission(req, res, 'manage_users');
      if (!session) return;
      const result = listAdminSessions({ limit: url.searchParams.get('limit') || 100 });
      recordAuditEvent({ action: 'admin_session_directory_view', actorEmail: session.email, status: 'ok', details: { count: result.count, noTokenOutput: true, noUserMutation: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/admin/sessions/revoke-user' || url.pathname === '/admin/sessions/revoke-user') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_users');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const targetEmail = String(body.email || '').trim().toLowerCase();
      const keepCurrent = body.keepCurrent !== false;
      const currentToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const result = revokeAdminSessionsForUser({ email: targetEmail, exceptToken: keepCurrent && targetEmail === session.email ? currentToken : null });
      const response = { ...result, mode: 'admin-session-user-revoke', targetEmail, keepCurrent: keepCurrent && targetEmail === session.email, safety: { adminOnly: true, noTokenOutput: true, noPasswordOutput: true, noEmailSent: true, noDeliveryUnlock: true, realDeliveryAllowed: false }, realDeliveryAllowed: false };
      recordAuditEvent({ action: 'admin_session_user_revoke', actorEmail: session.email, target: targetEmail || null, status: result.ok ? 'ok' : 'rejected', details: { sessionsRevoked: result.sessionsRevoked || 0, errors: result.errors || [], noTokenOutput: true, noPasswordOutput: true, realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, response);
    }

    if (url.pathname === '/api/admin/users/invite-plan' || url.pathname === '/admin/users/invite-plan') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_users');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = planAdminUserInvite({ email: body.email, role: body.role, requestedBy: session.email });
      recordAuditEvent({ action: 'admin_user_invite_plan', actorEmail: session.email, target: body.email || null, status: result.ok ? 'ok' : 'rejected', details: { role: body.role || null, errors: result.errors || [], noEmailSent: true, noUserMutation: true, noTokenOutput: true, realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/admin/users/invite' || url.pathname === '/admin/users/invite') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_users');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = createAdminUserInvite({ email: body.email, role: body.role, inviteCode: body.inviteCode, expiresInHours: body.expiresInHours, requestedBy: session.email });
      recordAuditEvent({ action: 'admin_user_invite_create', actorEmail: session.email, target: body.email || null, status: result.ok ? 'ok' : 'rejected', details: { role: body.role || null, errors: result.errors || [], noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/admin/users/role' || url.pathname === '/admin/users/role') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_users');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = updateAdminUserRole({ email: body.email, role: body.role, requestedBy: session.email });
      if (result.ok) {
        const currentToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        const sessionRevocation = revokeAdminSessionsForUser({ email: body.email, exceptToken: String(body.email || '').trim().toLowerCase() === session.email ? currentToken : null });
        result.sessionRevocation = { sessionsRevoked: sessionRevocation.sessionsRevoked || 0, persistenceMode: sessionRevocation.persistenceMode, reason: 'role_change_requires_fresh_login_for_target_user', realDeliveryAllowed: false };
      }
      recordAuditEvent({ action: 'admin_user_role_update', actorEmail: session.email, target: body.email || null, status: result.ok ? 'ok' : 'rejected', details: { requestedRole: body.role || null, savedRole: result.user?.role || null, sessionsRevoked: result.sessionRevocation?.sessionsRevoked || 0, errors: result.errors || [], noEmailSent: true, noPasswordOutput: true, noTokenOutput: true, realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/admin/users/accept-invite' || url.pathname === '/admin/users/accept-invite') {
      if (!requireMethod(req, res, 'POST')) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = acceptAdminUserInvite({ email: body.email, inviteCode: body.inviteCode, password: body.password });
      recordAuditEvent({ action: 'admin_user_invite_accept', actorEmail: body.email || null, target: body.email || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/admin/users/password-reset-plan' || url.pathname === '/admin/users/password-reset-plan') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_users');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = createPasswordResetPlan({ email: body.email, resetCode: body.resetCode, expiresInHours: body.expiresInHours, requestedBy: session.email });
      recordAuditEvent({ action: 'admin_user_password_reset_plan', actorEmail: session.email, target: body.email || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/auth/password-reset/complete' || url.pathname === '/auth/password-reset/complete') {
      if (!requireMethod(req, res, 'POST')) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = completePasswordReset({ email: body.email, resetCode: body.resetCode, password: body.password });
      recordAuditEvent({ action: 'admin_user_password_reset_complete', actorEmail: body.email || null, target: body.email || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
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

    if (url.pathname === '/api/database/repositories' || url.pathname === '/database/repositories') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = repositoryReadiness();
      recordAuditEvent({ action: 'database_repository_readiness_view', actorEmail: session.email, target: 'postgresql-repositories', details: { schemaFoundationReady: readiness.schemaFoundationReady, liveRepositoryEnabled: readiness.liveRepositoryEnabled, modules: readiness.summary.totalModules, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/audit-log' || url.pathname === '/audit-log') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requirePermission(req, res, 'view_audit_log');
      if (!session) return;
      return jsonResponse(res, 200, listAuditLog());
    }

    if (url.pathname === '/api/contacts' || url.pathname === '/contacts') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, listContacts());
    }

    if (url.pathname === '/api/contacts/browser' || url.pathname === '/contacts/browser') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = browseContacts(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_browser_search', actorEmail: session.email, status: 'ok', details: { filters: result.filters, matchedContacts: result.totals.matchedContacts, noContactMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/browser/export-preview' || url.pathname === '/contacts/browser/export-preview') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactBrowserExportPreview(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_browser_export_preview', actorEmail: session.email, status: 'ok', details: { filters: result.filters, rowCount: result.rowCount, exportMutation: false, noContactMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/detail' || url.pathname === '/contacts/detail') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactDetailDrilldown(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_detail_drilldown_view', actorEmail: session.email, target: result.contact?.email || url.searchParams.get('email') || url.searchParams.get('id') || null, status: result.ok ? 'ok' : 'not_found', details: { suppressed: Boolean(result.contact?.suppressed), riskFlags: result.contact?.riskFlags || [], noContactMutation: true, noSuppressionMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, result.ok ? 200 : 404, result);
    }

    if (url.pathname === '/api/contacts/source-quality' || url.pathname === '/contacts/source-quality') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = sourceQualityDrilldown(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_source_quality_drilldown_view', actorEmail: session.email, target: result.source || null, status: 'ok', details: { score: result.summary?.score ?? null, total: result.summary?.total || 0, recommendations: result.recommendations, noContactMutation: true, noSuppressionMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/source-hygiene-plan' || url.pathname === '/contacts/source-hygiene-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = sourceHygieneActionPlan(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_source_hygiene_plan_view', actorEmail: session.email, status: 'ok', details: { scoreThreshold: result.scoreThreshold, sourcesReviewed: result.totals.sourcesReviewed, reviewGates: result.totals.reviewGates, noContactMutation: true, noSuppressionMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/source-quality-matrix' || url.pathname === '/contacts/source-quality-matrix') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = sourceQualityMatrix(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_source_quality_matrix_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, contactsReviewed: result.totals.contactsReviewed, sourceDomainCells: result.totals.sourceDomainCells, reviewGates: result.totals.reviewGates, noContactMutation: true, noSuppressionMutation: true, noSegmentMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/campaign-fit-plan' || url.pathname === '/contacts/campaign-fit-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactCampaignFitPlan(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_campaign_fit_plan_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, matchedContacts: result.totals.matchedContacts, blockedContacts: result.totals.blockedContacts, automaticSegmentMutationAllowed: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/source-detail-review' || url.pathname === '/contacts/source-detail-review') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactSourceDetailReview(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_source_detail_review_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, matchedContacts: result.totals.matchedContacts, missingSourceDetailContacts: result.totals.missingSourceDetailContacts, automaticContactMutationAllowed: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/consent-provenance-review' || url.pathname === '/contacts/consent-provenance-review') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactConsentProvenanceReview(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_consent_provenance_review_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, matchedContacts: result.totals.matchedContacts, reviewRequiredContacts: result.totals.reviewRequiredContacts, automaticContactMutationAllowed: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/engagement-recency-plan' || url.pathname === '/contacts/engagement-recency-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactEngagementRecencyPlan(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_engagement_recency_plan_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, matchedContacts: result.totals.matchedContacts, blockedContacts: result.totals.blockedContacts, automaticQueueMutationAllowed: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/domain-risk-plan' || url.pathname === '/contacts/domain-risk-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactDomainRiskPlan(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_domain_risk_plan_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, domainsReviewed: result.totals.domainsReviewed, highPriorityDomains: result.totals.highPriorityDomains, mxProbePerformed: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/repermission-plan' || url.pathname === '/contacts/repermission-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactRepermissionPlan(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_repermission_plan_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, reviewContacts: result.totals.repermissionReviewContacts, doNotContact: result.totals.doNotContact, outboundRepermissionAllowed: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/source-quarantine-plan' || url.pathname === '/contacts/source-quarantine-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactSourceQuarantinePlan(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_source_quarantine_plan_view', actorEmail: session.email, status: 'ok', details: { scoreThreshold: result.scoreThreshold, sourcesReviewed: result.totals.sourcesReviewed, quarantineRecommended: result.totals.quarantineRecommended, automaticSourceMutationAllowed: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/audience-exclusion-preview' || url.pathname === '/contacts/audience-exclusion-preview') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactAudienceExclusionPreview(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_audience_exclusion_preview_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, matchedContacts: result.totals.matchedContacts, excludedContacts: result.totals.excludedContacts, automaticSegmentMutationAllowed: false, noSegmentMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/risk-triage' || url.pathname === '/contacts/risk-triage') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactRiskTriageQueue(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_risk_triage_queue_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, riskyContacts: result.totals.riskyContacts, riskTypes: result.totals.riskTypes, automaticAudienceMutationAllowed: false, noContactMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/suppression-review' || url.pathname === '/contacts/suppression-review') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactSuppressionReviewPlan(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_suppression_review_plan_view', actorEmail: session.email, status: 'ok', details: { filters: result.filters, suppressedContacts: result.totals.suppressedContacts, automaticUnsuppressionAllowed: false, noSuppressionMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/audience-readiness' || url.pathname === '/contacts/audience-readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = contactAudienceReadinessReview(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'contact_audience_readiness_review_view', actorEmail: session.email, status: 'ok', details: { matchedContacts: result.totals.matchedContacts, readyContacts: result.totals.readyContacts, blockedContacts: result.totals.blockedContacts, noContactMutation: true, noSuppressionMutation: true, noSegmentMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/import/validate' || url.pathname === '/contacts/import/validate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_contacts');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = validateContactImport(body.contacts);
      recordAuditEvent({ action: 'contact_import_validate', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { acceptedCount: result.acceptedCount, rejectedCount: result.rejectedCount } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/contacts/import' || url.pathname === '/contacts/import') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requirePermission(req, res, 'manage_contacts');
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = importContacts(body.contacts, session.email);
      recordAuditEvent({ action: 'contact_import', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { importedCount: result.importedCount, updatedCount: result.updatedCount, rejectedCount: result.rejectedCount, error: result.error } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/list-hygiene/plan' || url.pathname === '/list-hygiene/plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const staleAfterDays = Number(url.searchParams.get('staleAfterDays') || 180);
      const result = buildListHygienePlan({ staleAfterDays });
      recordAuditEvent({ action: 'list_hygiene_plan_view', actorEmail: session.email, status: 'ok', details: { riskyContacts: result.totals.riskyContacts, staleContacts: result.totals.staleContacts, cleanupMutation: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/contacts/dedupe-merge-plan' || url.pathname === '/contacts/dedupe-merge-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = buildContactDedupeMergePlan();
      recordAuditEvent({ action: 'contact_dedupe_merge_plan_view', actorEmail: session.email, status: 'ok', details: { mergePlans: result.totals.mergePlans, exactEmailGroups: result.totals.exactEmailGroups, sameNameDomainGroups: result.totals.sameNameDomainGroups, mergeMutation: false, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
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

    if (url.pathname === '/api/segments/snapshots' || url.pathname === '/segments/snapshots') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') {
        const result = listSegmentSnapshots({ segmentId: url.searchParams.get('segmentId') });
        recordAuditEvent({ action: 'segment_snapshot_list', actorEmail: session.email, status: 'ok', details: { segmentId: url.searchParams.get('segmentId') || null, count: result.count, noContactMutation: true, realDeliveryAllowed: false } });
        return jsonResponse(res, 200, result);
      }
      if (req.method !== 'POST') return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = createSegmentSnapshot({ segmentId: body.segmentId, actorEmail: session.email });
      recordAuditEvent({ action: 'segment_snapshot_create', actorEmail: session.email, target: body.segmentId || null, status: result.ok ? 'ok' : 'rejected', details: { audienceCount: result.snapshot?.audienceCount, errors: result.errors || [], noContactMutation: true, realDeliveryAllowed: false } });
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
      recordAuditEvent({ action: 'campaign_create', actorEmail: session.email, target: result.campaign?.id || body.name || null, status: result.ok ? 'ok' : 'rejected', details: { campaignId: result.campaign?.id || null, estimatedAudience: result.campaign?.estimatedAudience, suppressedCount: result.campaign?.suppressedCount, hasAffiliateMetadata: Boolean(result.affiliate?.affiliateProgram || result.affiliate?.affiliateOfferId), errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/campaigns/calendar' || url.pathname === '/campaigns/calendar') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = campaignCalendar(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'campaign_calendar_view', actorEmail: session.email, status: 'ok', details: { domain: result.domain, days: result.days, scheduledCampaigns: result.totals.scheduledCampaigns, overCapDays: result.totals.overCapDays, noQueueMutation: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/campaigns/calendar/allocation' || url.pathname === '/campaigns/calendar/allocation') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = campaignCalendarAllocation(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'campaign_calendar_allocation_view', actorEmail: session.email, status: 'ok', details: { domains: result.totals.domains, days: result.days, scheduledCampaigns: result.totals.scheduledCampaigns, overCapDays: result.totals.overCapDays, tightDays: result.totals.tightDays, noScheduleMutation: true, noQueueMutation: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/campaigns/calendar/drilldown' || url.pathname === '/campaigns/calendar/drilldown') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = campaignCalendarDrilldown(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'campaign_calendar_drilldown_view', actorEmail: session.email, status: 'ok', details: { domain: result.domain, date: result.date, planned: result.capacity.planned, remaining: result.capacity.remaining, capExceeded: result.capacity.capExceeded, noScheduleMutation: true, noQueueMutation: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/campaigns/calendar/reschedule-plan' || url.pathname === '/campaigns/calendar/reschedule-plan') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = campaignCalendarReschedulePlan(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'campaign_calendar_reschedule_plan_view', actorEmail: session.email, status: 'ok', details: { days: result.days, domains: result.totals.domains, suggestions: result.totals.suggestions, highPriority: result.totals.highPriority, noScheduleMutation: true, noQueueMutation: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/campaigns/calendar/capacity-forecast' || url.pathname === '/campaigns/calendar/capacity-forecast') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = campaignCalendarCapacityForecast(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'campaign_calendar_capacity_forecast_view', actorEmail: session.email, status: 'ok', details: { days: result.days, domains: result.totals.domains, targetCount: result.targetCount, domainsWithTargetCapacity: result.totals.domainsWithTargetCapacity, noScheduleMutation: true, noQueueMutation: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/campaigns/calendar/warmup-board' || url.pathname === '/campaigns/calendar/warmup-board') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = campaignCalendarWarmupBoard(Object.fromEntries(url.searchParams.entries()));
      recordAuditEvent({ action: 'campaign_calendar_warmup_board_view', actorEmail: session.email, status: 'ok', details: { windowDays: result.windowDays, calendarDays: result.totals.calendarDays, domains: result.totals.domains, openDays: result.totals.openDays, tightDays: result.totals.tightDays, overCapDays: result.totals.overCapDays, noScheduleMutation: true, noQueueMutation: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
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
      const result = scheduleCampaignDryRun({ campaignId: body.campaignId, scheduledAt: body.scheduledAt, senderDomain: body.senderDomain, actorEmail: session.email });
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

    if (url.pathname === '/api/campaigns/affiliate-summary' || url.pathname === '/campaigns/affiliate-summary') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const summary = campaignAffiliateSummary();
      recordAuditEvent({ action: 'campaign_affiliate_summary_view', actorEmail: session.email, details: { campaignCount: summary.count, programs: summary.programs.length, noSecretOutput: true, realDelivery: false } });
      return jsonResponse(res, 200, summary);
    }

    if (url.pathname === '/api/campaigns/audit-timeline' || url.pathname === '/campaigns/audit-timeline') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const campaignId = url.searchParams.get('campaignId') || '';
      const campaignEvents = listAuditLog().events.filter((event) => !campaignId || event.target === campaignId || event.details?.campaignId === campaignId || event.target === campaignId).filter((event) => event.action.startsWith('campaign_'));
      const result = { ok: true, mode: 'campaign-audit-timeline-safe-summary', campaignId: campaignId || null, count: campaignEvents.length, events: campaignEvents.slice(0, 100), safety: { adminSessionRequired: true, noSecretsIncluded: true, noUserMutation: true, realDeliveryAllowed: false }, realDeliveryAllowed: false };
      recordAuditEvent({ action: 'campaign_audit_timeline_view', actorEmail: session.email, target: campaignId || 'all-campaigns', details: { count: result.count, noSecretOutput: true, realDelivery: false } });
      return jsonResponse(res, 200, result);
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

    if (url.pathname === '/api/email/warmup/plan' || url.pathname === '/email/warmup/plan') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = planWarmupSchedule(body);
      recordAuditEvent({ action: 'email_warmup_plan_preview', actorEmail: session.email, target: result.domain || body.domain || null, status: result.ok ? 'ok' : 'rejected', details: { days: result.inputs?.days || body.days || null, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/email/warmup/policy' || url.pathname === '/email/warmup/policy') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') {
        const result = listWarmupPolicies();
        recordAuditEvent({ action: 'email_warmup_policy_view', actorEmail: session.email, target: 'warmup-policy', details: { count: result.count, realDeliveryAllowed: false } });
        return jsonResponse(res, 200, result);
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
        const result = saveWarmupPolicy(body);
        recordAuditEvent({ action: 'email_warmup_policy_save', actorEmail: session.email, target: result.policy?.domain || body.domain || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], realDeliveryAllowed: false } });
        return jsonResponse(res, result.ok ? 200 : 400, result);
      }
      return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
    }

    if (url.pathname === '/api/email/warmup/schedule-cap' || url.pathname === '/email/warmup/schedule-cap') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = evaluateWarmupScheduleCap(body);
      recordAuditEvent({ action: 'email_warmup_schedule_cap_evaluate', actorEmail: session.email, target: result.domain || body.domain || null, status: result.capExceeded ? 'rejected' : 'ok', details: { estimatedAudience: result.estimatedAudience, dailyCap: result.dailyCap, errors: result.errors || [], realDeliveryAllowed: false } });
      return jsonResponse(res, result.ok && !result.capExceeded ? 200 : 400, result);
    }

    if (url.pathname === '/api/email/reputation/policy' || url.pathname === '/email/reputation/policy') {
      const session = requireSession(req, res);
      if (!session) return;
      if (req.method === 'GET') {
        const result = getReputationPolicy();
        recordAuditEvent({ action: 'email_reputation_policy_view', actorEmail: session.email, target: result.policy.domain, details: { actionMode: result.policy.actionMode, realDeliveryAllowed: false } });
        return jsonResponse(res, 200, result);
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
        const result = saveReputationPolicy(body);
        recordAuditEvent({ action: 'email_reputation_policy_save', actorEmail: session.email, target: result.policy?.domain || body.domain || null, status: result.ok ? 'ok' : 'rejected', details: { errors: result.errors || [], actionMode: result.policy?.actionMode || 'recommendation_only', realDeliveryAllowed: false } });
        return jsonResponse(res, result.ok ? 200 : 400, result);
      }
      return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: 'GET, POST' });
    }

    if (url.pathname === '/api/email/reputation/auto-pause' || url.pathname === '/email/reputation/auto-pause') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = evaluateAutoPause({ domain: url.searchParams.get('domain') || undefined });
      recordAuditEvent({ action: 'email_reputation_auto_pause_evaluate', actorEmail: session.email, target: result.domain, status: result.recommendPause ? 'rejected' : 'ok', details: { thresholdBreaches: result.thresholdBreaches, insufficientData: result.insufficientData, recommendationOnly: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
    }

    if (url.pathname === '/api/email/reputation/domain-rollup' || url.pathname === '/email/reputation/domain-rollup') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const result = evaluateDomainReputationRollup({ limit: url.searchParams.get('limit') || undefined });
      recordAuditEvent({ action: 'email_reputation_domain_rollup_view', actorEmail: session.email, target: 'recipient-domains', status: result.domains.some((entry) => entry.thresholdBreaches.length > 0) ? 'rejected' : 'ok', details: { domains: result.totalDomains, shown: result.count, recommendationOnly: true, noQueueMutation: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, result);
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

    if (url.pathname === '/api/send-queue/readiness' || url.pathname === '/send-queue/readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = sendQueueReadiness();
      recordAuditEvent({ action: 'send_queue_readiness_view', actorEmail: session.email, target: 'send-queue', status: readiness.ok ? 'ok' : 'rejected', details: { errors: readiness.errors, queuedDryRuns: readiness.totals.queuedDryRuns, noDispatch: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
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

    if (url.pathname === '/api/email/events/provider-message' || url.pathname === '/email/events/provider-message') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const lookup = findEmailEventsByProviderMessageId(url.searchParams.get('providerMessageId'));
      recordAuditEvent({ action: 'email_provider_message_event_lookup', actorEmail: session.email, target: lookup.ok ? lookup.providerMessageId : 'provider-message', status: lookup.ok ? 'ok' : 'rejected', details: { count: lookup.count || 0, error: lookup.error || null, realDelivery: false } });
      return jsonResponse(res, lookup.ok ? 200 : 400, lookup);
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

    if (url.pathname === '/api/email/bounce-mailbox/readiness' || url.pathname === '/email/bounce-mailbox/readiness') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const readiness = bounceMailboxReadiness();
      recordAuditEvent({ action: 'email_bounce_mailbox_readiness_view', actorEmail: session.email, target: 'bounce-mailbox', status: readiness.ok ? 'ok' : 'rejected', details: { blockers: readiness.blockers, noMailboxConnection: true, noSecretOutput: true, realDeliveryAllowed: false } });
      return jsonResponse(res, 200, readiness);
    }

    if (url.pathname === '/api/email/powermta/accounting/validate-import' || url.pathname === '/email/powermta/accounting/validate-import') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = validatePowerMtaAccountingCsv({ csv: body.csv, source: body.source });
      recordAuditEvent({ action: 'email_powermta_accounting_import_validate', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { acceptedCount: result.acceptedCount || 0, rejectedCount: result.rejectedCount || 0, error: result.error || null, validationOnly: true, realDelivery: false } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/email/powermta/accounting/import' || url.pathname === '/email/powermta/accounting/import') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = importPowerMtaAccountingCsv({ csv: body.csv, source: body.source, actorEmail: session.email });
      recordAuditEvent({ action: 'email_powermta_accounting_import', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { acceptedCount: result.acceptedCount || 0, rejectedCount: result.rejectedCount || 0, eventRecorded: result.eventRecorded, suppressionCreated: result.suppressionCreated, realDelivery: false } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/email/bounce-parse/validate' || url.pathname === '/email/bounce-parse/validate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = validateBounceMessage({ message: body.message, source: body.source, campaignId: body.campaignId, contactId: body.contactId });
      recordAuditEvent({ action: 'email_bounce_parse_validate', actorEmail: session.email, status: result.ok ? 'ok' : 'rejected', details: { parsedType: result.parsed?.type || null, errors: result.errors || [], validationOnly: true, realDelivery: false } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/email/bounce-parse/ingest' || url.pathname === '/email/bounce-parse/ingest') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = ingestBounceMessage({ message: body.message, source: body.source, campaignId: body.campaignId, contactId: body.contactId, actorEmail: session.email });
      recordAuditEvent({ action: 'email_bounce_parse_ingest', actorEmail: session.email, target: result.parsed?.email || null, status: result.ok ? 'ok' : 'rejected', details: { parsedType: result.parsed?.type || null, eventRecorded: result.eventRecorded, suppressionCreated: result.suppressionCreated, errors: result.errors || [], realDelivery: false } });
      return jsonResponse(res, result.ok ? 200 : 400, result);
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

    if (url.pathname === '/api/email/delivery-events/ingest' || url.pathname === '/email/delivery-events/ingest') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = ingestDeliveryEvents({ events: body.events, actorEmail: session.email });
      recordAuditEvent({ action: 'email_delivery_events_ingest', actorEmail: session.email, status: result.ok ? 'ok' : 'partial_or_rejected', details: { acceptedCount: result.acceptedCount, rejectedCount: result.rejectedCount, error: result.error, suppressionCreated: false, realDelivery: false } });
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    return jsonResponse(res, 404, {
      ok: false,
      error: 'not_found',
      message: 'OracleStreet API baseline is running.'
    });
  };
};
