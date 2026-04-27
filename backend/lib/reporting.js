import { listAuditLog } from './auditLog.js';
import { listEmailEvents } from './emailEvents.js';
import { getEmailProviderConfig, validateSelectedProviderConfig } from './emailProvider.js';
import { getRateLimitConfig } from './rateLimits.js';
import { listSendQueue } from './sendQueue.js';
import { listSuppressions } from './suppressions.js';

export const emailReportingSummary = (env = process.env) => {
  const audit = listAuditLog();
  const queue = listSendQueue();
  const suppressions = listSuppressions();
  const emailEvents = listEmailEvents();
  const queuedDryRuns = queue.jobs.filter((job) => job.status === 'queued_dry_run');
  const eventCounts = emailEvents.events.reduce((counts, event) => {
    counts[event.type] = (counts[event.type] || 0) + 1;
    return counts;
  }, {});
  const suppressionCounts = suppressions.suppressions.reduce((counts, suppression) => {
    counts[suppression.reason] = (counts[suppression.reason] || 0) + 1;
    return counts;
  }, {});

  return {
    ok: true,
    mode: 'safe-reporting',
    provider: getEmailProviderConfig(env),
    providerValidation: validateSelectedProviderConfig(env),
    totals: {
      queuedDryRuns: queuedDryRuns.length,
      suppressions: suppressions.count,
      emailEvents: emailEvents.count,
      auditEvents: audit.count,
      bounces: eventCounts.bounce || 0,
      complaints: eventCounts.complaint || 0,
      dispatched: eventCounts.dispatched || 0
    },
    suppressionCounts,
    eventCounts,
    rateLimits: getRateLimitConfig(env),
    safety: {
      realDeliveryAllowed: false,
      deliveryMode: 'dry-run-only',
      complianceGates: {
        consentSource: 'enforced_for_test_send_and_queue',
        suppression: 'enforced_for_queue',
        unsubscribe: 'baseline_records_suppression',
        dispatchEvents: 'dry_run_dispatch_records_event',
        bounceComplaint: 'manual_ingest_records_event_and_suppression',
        rateLimits: 'dry_run_warmup_enforced',
        audit: 'baseline_in_memory'
      }
    }
  };
};
