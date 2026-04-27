import { dryRunSend, validateTestMessage } from './emailProvider.js';
import { evaluateRateLimit, getRateLimitConfig } from './rateLimits.js';
import { getSuppression, isSuppressed } from './suppressions.js';

const queue = [];
let sequence = 0;

const nowIso = () => new Date().toISOString();

export const resetSendQueueForTests = () => {
  queue.length = 0;
  sequence = 0;
};

export const listSendQueue = () => ({
  ok: true,
  mode: 'dry-run-queue',
  count: queue.length,
  rateLimits: getRateLimitConfig(),
  jobs: queue.map((job) => ({ ...job, safety: { ...job.safety } }))
});

export const dispatchNextDryRunJob = ({ actorEmail = null } = {}) => {
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
    realDelivery: false
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

  const rateLimit = evaluateRateLimit({ queue, to: validation.normalized.to, env });
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
  queue.push(job);

  return {
    ok: true,
    mode: 'dry-run-queue',
    job,
    realDelivery: false
  };
};
