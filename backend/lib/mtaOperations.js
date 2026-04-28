import { bounceMailboxReadiness } from './bounceMailboxReadiness.js';
import { controlledLiveTestReadiness } from './controlledLiveTestReadiness.js';
import { listEmailEvents } from './emailEvents.js';
import { getProviderAdapter } from './emailProvider.js';
import { evaluateDomainReputationRollup } from './reputationControls.js';
import { sendingReadinessSummary } from './reporting.js';
import { sendQueueReadiness } from './sendQueueReadiness.js';
import { listSuppressions } from './suppressions.js';

const countBy = (items, keyFn) => items.reduce((counts, item) => {
  const key = keyFn(item) || 'unknown';
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

export const mtaOperationsDashboard = (env = process.env) => {
  const sendingReadiness = sendingReadinessSummary(env);
  const adapter = getProviderAdapter(env);
  const queueReadiness = sendQueueReadiness();
  const bounceMailbox = bounceMailboxReadiness(env);
  const liveTest = controlledLiveTestReadiness(env);
  const reputationRollup = evaluateDomainReputationRollup({ limit: 8 });
  const events = listEmailEvents().events || [];
  const suppressions = listSuppressions().suppressions || [];
  const eventCounts = countBy(events, (event) => event.type);
  const suppressionReasons = countBy(suppressions, (entry) => entry.reason);
  const operationalBlockers = [
    ...sendingReadiness.blockers,
    ...queueReadiness.errors,
    ...bounceMailbox.blockers.map((blocker) => `bounce_mailbox:${blocker}`),
    ...liveTest.blockers.map((blocker) => `controlled_live_test:${blocker}`)
  ];
  const recommendations = [];
  if (sendingReadiness.blockers.length) recommendations.push('resolve_sending_readiness_blockers_before_any_live_provider_attempt');
  if (queueReadiness.totals.queuedDryRuns > 0) recommendations.push('dispatch_or_review_queued_dry_runs_one_at_a_time');
  if ((eventCounts.bounce || 0) > 0 || (eventCounts.complaint || 0) > 0) recommendations.push('review_bounce_complaint_sources_and_suppression_coverage');
  if (reputationRollup.domains.some((domain) => domain.thresholdBreaches.length > 0)) recommendations.push('reduce_or_pause_breached_recipient_domains_manually');
  if (!recommendations.length) recommendations.push('continue_dry_run_training_and_event_collection');

  return {
    ok: true,
    mode: 'mta-reputation-operations-dashboard',
    provider: {
      name: adapter.name,
      dispatchMode: adapter.dispatchMode,
      ready: adapter.ready,
      externalDelivery: adapter.externalDelivery,
      realDeliveryAllowed: false
    },
    queue: queueReadiness.totals,
    events: {
      total: events.length,
      counts: eventCounts
    },
    suppressions: {
      total: suppressions.length,
      reasons: suppressionReasons
    },
    readiness: {
      sendingBlockers: sendingReadiness.blockers,
      queueErrors: queueReadiness.errors,
      bounceMailboxBlockers: bounceMailbox.blockers,
      controlledLiveTestBlockers: liveTest.blockers,
      operationalBlockers
    },
    reputation: {
      totalDomains: reputationRollup.totalDomains,
      domains: reputationRollup.domains
    },
    recommendations,
    safety: {
      adminOnly: true,
      readOnly: true,
      recommendationOnly: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noMailboxConnection: true,
      noNetworkProbe: true,
      noSecretOutput: true,
      noExternalDelivery: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};
