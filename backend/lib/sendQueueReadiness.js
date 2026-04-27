import { listSendQueue } from './sendQueue.js';

export const sendQueueReadiness = () => {
  const queue = listSendQueue();
  const queued = queue.jobs.filter((job) => job.status === 'queued_dry_run');
  const dispatched = queue.jobs.filter((job) => job.status === 'dispatched_dry_run');
  const missingUnsubscribe = queued.filter((job) => !job.safety?.unsubscribeChecked);
  const missingRateLimit = queued.filter((job) => !job.safety?.rateLimitChecked);
  const missingSuppression = queued.filter((job) => !job.safety?.suppressionChecked);
  const missingTracking = queued.filter((job) => job.campaignId && (!job.openTrackingUrl || !job.clickTrackingUrl));
  const nonDryRun = queue.jobs.filter((job) => job.safety?.realDelivery === true || job.provider !== 'dry-run');
  const errors = [];

  if (missingUnsubscribe.length > 0) errors.push('queued_job_missing_unsubscribe_gate');
  if (missingRateLimit.length > 0) errors.push('queued_job_missing_rate_limit_gate');
  if (missingSuppression.length > 0) errors.push('queued_job_missing_suppression_gate');
  if (nonDryRun.length > 0) errors.push('non_dry_run_job_present');

  return {
    ok: errors.length === 0,
    mode: 'send-queue-readiness-safe-gate',
    totals: {
      allJobs: queue.count,
      queuedDryRuns: queued.length,
      dispatchedDryRuns: dispatched.length,
      missingUnsubscribeGate: missingUnsubscribe.length,
      missingRateLimitGate: missingRateLimit.length,
      missingSuppressionGate: missingSuppression.length,
      campaignJobsMissingTracking: missingTracking.length,
      nonDryRunJobs: nonDryRun.length
    },
    dispatchPolicy: {
      current: 'manual_one_dry_run_job_at_a_time',
      providerAdapter: 'dry-run',
      externalDelivery: 'locked',
      campaignScaleDispatch: 'blocked_until_controlled_live_approval'
    },
    gates: {
      consentSource: 'required_before_enqueue',
      unsubscribe: 'required_before_enqueue',
      suppression: 'checked_before_enqueue',
      rateLimit: 'checked_before_enqueue',
      provider: 'dry_run_only',
      audit: 'enqueue_and_dispatch_actions_audited'
    },
    sampleQueuedJobIds: queued.slice(0, 10).map((job) => job.id),
    errors,
    safety: {
      noQueueMutation: true,
      noDispatch: true,
      noNetworkProbe: true,
      noSecretOutput: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};
