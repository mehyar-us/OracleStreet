import { dryRunSend, validateTestMessage } from './emailProvider.js';

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
  jobs: queue.map((job) => ({ ...job }))
});

export const enqueueDryRunSend = (message, actorEmail, env = process.env) => {
  const validation = validateTestMessage(message);
  if (!validation.ok) {
    return { ok: false, mode: 'dry-run-queue', errors: validation.errors };
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
    safety: {
      consentChecked: true,
      sourceChecked: true,
      unsubscribeChecked: true,
      suppressionChecked: 'pending_database_enforcement',
      rateLimitChecked: 'pending_warmup_controls',
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
