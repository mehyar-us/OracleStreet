import { dryRunSend, validateTestMessage } from './emailProvider.js';
import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';
import { evaluateRateLimit, getRateLimitConfig } from './rateLimits.js';
import { getSuppression, isSuppressed } from './suppressions.js';

const queue = [];
let sequence = 0;

const nowIso = () => new Date().toISOString();

export const resetSendQueueForTests = () => {
  queue.length = 0;
  sequence = 0;
};

const pgRowToJob = ([id, status, provider, providerMessageId, recipientEmail, subject, source, campaignId, contactId, unsubscribeUrl, openTrackingUrl, clickTrackingUrl, safetyJson, createdAt, dispatchedAt]) => ({
  id,
  status,
  provider,
  providerMessageId: providerMessageId || null,
  to: recipientEmail,
  subject,
  source,
  actorEmail: null,
  campaignId: campaignId || null,
  contactId: contactId || null,
  unsubscribeUrl: unsubscribeUrl || null,
  openTrackingUrl: openTrackingUrl || null,
  clickTrackingUrl: clickTrackingUrl || null,
  safety: safetyJson ? JSON.parse(safetyJson) : {},
  createdAt,
  dispatchedAt: dispatchedAt || null
});

const listSendQueueFromPostgres = () => runLocalPgRows(`
  SELECT id, status, provider, coalesce(provider_message_id, ''), coalesce(recipient_email, ''), coalesce(subject, ''), coalesce(source, ''), coalesce(campaign_id, ''), coalesce(contact_id, ''), coalesce(unsubscribe_url, ''), coalesce(open_tracking_url, ''), coalesce(click_tracking_url, ''), safety::text, created_at::text, coalesce(dispatched_at::text, '')
  FROM send_jobs
  ORDER BY created_at DESC
  LIMIT 1000;
`).map(pgRowToJob);

export const listSendQueue = () => {
  if (isPgRepositoryEnabled('send_queue')) {
    try {
      const jobs = listSendQueueFromPostgres();
      return { ok: true, mode: 'dry-run-queue', count: jobs.length, rateLimits: getRateLimitConfig(), jobs, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory view
    }
  }
  return {
    ok: true,
    mode: 'dry-run-queue',
    count: queue.length,
    rateLimits: getRateLimitConfig(),
    jobs: queue.map((job) => ({ ...job, safety: { ...job.safety } })),
    persistenceMode: isPgRepositoryEnabled('send_queue') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};

export const dispatchNextDryRunJob = ({ actorEmail = null } = {}) => {
  if (isPgRepositoryEnabled('send_queue')) {
    try {
      const rows = runLocalPgRows(`
        SELECT id, status, provider, coalesce(provider_message_id, ''), coalesce(recipient_email, ''), coalesce(subject, ''), coalesce(source, ''), coalesce(campaign_id, ''), coalesce(contact_id, ''), coalesce(unsubscribe_url, ''), coalesce(open_tracking_url, ''), coalesce(click_tracking_url, ''), safety::text, created_at::text, coalesce(dispatched_at::text, '')
        FROM send_jobs
        WHERE status = 'queued_dry_run'
        ORDER BY created_at ASC
        LIMIT 1;
      `);
      if (!rows[0]) return { ok: false, mode: 'dry-run-dispatch', errors: ['no_queued_dry_run_jobs'] };
      const job = pgRowToJob(rows[0]);
      const providerMessageId = `dryrun_dispatch_${Date.now().toString(36)}`;
      const safety = { ...job.safety, providerAdapter: 'dry-run', dispatchMode: 'no_external_delivery', realDelivery: false };
      const updatedRows = runLocalPgRows(`
        UPDATE send_jobs
        SET status = 'dispatched_dry_run',
          provider_message_id = ${sqlLiteral(providerMessageId)},
          safety = ${sqlLiteral(JSON.stringify(safety))}::jsonb,
          dispatched_at = now()
        WHERE id = ${sqlLiteral(job.id)}
        RETURNING id, status, provider, coalesce(provider_message_id, ''), coalesce(recipient_email, ''), coalesce(subject, ''), coalesce(source, ''), coalesce(campaign_id, ''), coalesce(contact_id, ''), coalesce(unsubscribe_url, ''), coalesce(open_tracking_url, ''), coalesce(click_tracking_url, ''), safety::text, created_at::text, coalesce(dispatched_at::text, '');
      `);
      return { ok: true, mode: 'dry-run-dispatch', job: { ...pgRowToJob(updatedRows[0]), dispatchedBy: actorEmail }, realDelivery: false, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory dispatch
    }
  }

  const jobIndex = queue.findIndex((job) => job.status === 'queued_dry_run');
  if (jobIndex === -1) {
    return { ok: false, mode: 'dry-run-dispatch', errors: ['no_queued_dry_run_jobs'] };
  }

  const job = queue[jobIndex];
  const dispatched = {
    ...job,
    status: 'dispatched_dry_run',
    providerMessageId: `dryrun_dispatch_${Date.now().toString(36)}`,
    dispatchedBy: actorEmail,
    dispatchedAt: nowIso(),
    safety: {
      ...job.safety,
      providerAdapter: 'dry-run',
      dispatchMode: 'no_external_delivery',
      realDelivery: false
    }
  };
  queue[jobIndex] = dispatched;

  return {
    ok: true,
    mode: 'dry-run-dispatch',
    job: { ...dispatched, safety: { ...dispatched.safety } },
    realDelivery: false,
    persistenceMode: isPgRepositoryEnabled('send_queue') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};

export const enqueueDryRunSend = (message, actorEmail, env = process.env) => {
  const validation = validateTestMessage(message);
  if (!validation.ok) {
    return { ok: false, mode: 'dry-run-queue', errors: validation.errors };
  }

  if (isSuppressed(validation.normalized.to)) {
    const suppression = getSuppression(validation.normalized.to);
    return {
      ok: false,
      mode: 'dry-run-queue',
      errors: ['recipient_suppressed'],
      suppression: suppression ? { reason: suppression.reason, source: suppression.source } : null
    };
  }

  let rateLimitQueue = queue;
  if (isPgRepositoryEnabled('send_queue')) {
    try { rateLimitQueue = listSendQueueFromPostgres(); } catch (error) { rateLimitQueue = queue; }
  }
  const rateLimit = evaluateRateLimit({ queue: rateLimitQueue, to: validation.normalized.to, env });
  if (!rateLimit.ok) {
    return {
      ok: false,
      mode: 'dry-run-queue',
      errors: rateLimit.errors,
      rateLimit: {
        domain: rateLimit.domain,
        usage: rateLimit.usage,
        config: rateLimit.config
      }
    };
  }

  const dryRun = dryRunSend(message, env);
  if (!dryRun.ok) {
    return { ok: false, mode: 'dry-run-queue', provider: dryRun.provider, errors: dryRun.errors };
  }

  const job = {
    id: `sq_${(++sequence).toString().padStart(6, '0')}`,
    status: 'queued_dry_run',
    provider: dryRun.provider,
    to: dryRun.accepted.to,
    subject: dryRun.accepted.subject,
    source: dryRun.accepted.source,
    actorEmail,
    campaignId: message.campaignId || null,
    contactId: message.contactId || null,
    unsubscribeUrl: message.unsubscribeUrl || null,
    openTrackingUrl: message.openTrackingUrl || null,
    clickTrackingUrl: message.clickTrackingUrl || null,
    safety: {
      consentChecked: true,
      sourceChecked: true,
      unsubscribeChecked: true,
      unsubscribeLinkInjected: Boolean(message.unsubscribeUrl),
      openTrackingInjected: Boolean(message.openTrackingUrl),
      clickTrackingAvailable: Boolean(message.clickTrackingUrl),
      suppressionChecked: true,
      rateLimitChecked: true,
      rateLimit: {
        domain: rateLimit.domain,
        usageBeforeEnqueue: rateLimit.usage,
        config: rateLimit.config
      },
      realDelivery: false
    },
    createdAt: nowIso()
  };

  if (isPgRepositoryEnabled('send_queue')) {
    try {
      const rows = runLocalPgRows(`
        INSERT INTO send_jobs (id, status, provider, recipient_email, subject, source, campaign_id, contact_id, unsubscribe_url, open_tracking_url, click_tracking_url, safety, scheduled_at)
        VALUES (${sqlLiteral(job.id)}, 'queued_dry_run', ${sqlLiteral(job.provider)}, ${sqlLiteral(job.to)}, ${sqlLiteral(job.subject)}, ${sqlLiteral(job.source)}, ${sqlLiteral(job.campaignId)}, ${sqlLiteral(job.contactId)}, ${sqlLiteral(job.unsubscribeUrl)}, ${sqlLiteral(job.openTrackingUrl)}, ${sqlLiteral(job.clickTrackingUrl)}, ${sqlLiteral(JSON.stringify(job.safety))}::jsonb, now())
        RETURNING id, status, provider, coalesce(provider_message_id, ''), coalesce(recipient_email, ''), coalesce(subject, ''), coalesce(source, ''), coalesce(campaign_id, ''), coalesce(contact_id, ''), coalesce(unsubscribe_url, ''), coalesce(open_tracking_url, ''), coalesce(click_tracking_url, ''), safety::text, created_at::text, coalesce(dispatched_at::text, '');
      `);
      return { ok: true, mode: 'dry-run-queue', job: pgRowToJob(rows[0]), realDelivery: false, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory queue so the dry-run workflow remains usable.
    }
  }

  queue.push(job);

  return {
    ok: true,
    mode: 'dry-run-queue',
    job,
    realDelivery: false,
    persistenceMode: isPgRepositoryEnabled('send_queue') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};
