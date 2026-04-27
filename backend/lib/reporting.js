import { listAuditLog } from './auditLog.js';
import { listCampaigns } from './campaigns.js';
import { listEmailEvents } from './emailEvents.js';
import { senderDomainReadiness } from './domainReadiness.js';
import { getEmailProviderConfig, validateSelectedProviderConfig } from './emailProvider.js';
import { getRateLimitConfig } from './rateLimits.js';
import { listSendQueue } from './sendQueue.js';
import { listSuppressions } from './suppressions.js';

export const sendingReadinessSummary = (env = process.env) => {
  const provider = getEmailProviderConfig(env);
  const providerValidation = validateSelectedProviderConfig(env);
  const rateLimits = getRateLimitConfig(env);
  const domainReadiness = senderDomainReadiness(env);
  const blockers = [];
  const requiredGates = {
    providerConfigValid: providerValidation.ok,
    consentSourceEnforced: true,
    suppressionEnforced: true,
    unsubscribeRequired: true,
    bounceComplaintSuppression: true,
    rateLimitsConfigured: rateLimits.globalPerWindow > 0 && rateLimits.perDomainPerWindow > 0,
    senderDomainReady: domainReadiness.ok,
    auditLogging: true,
    manualDryRunProofRequired: true,
    realSendingFlagEnabled: provider.realSendingEnabled,
    nonDryRunProviderSelected: !['dry-run', 'local-capture'].includes(provider.provider)
  };

  if (!providerValidation.ok) blockers.push('provider_config_invalid');
  if (!requiredGates.rateLimitsConfigured) blockers.push('valid_rate_limits_required');
  if (!domainReadiness.ok) blockers.push('sender_domain_not_ready');
  if (!provider.realSendingEnabled) blockers.push('real_email_flag_disabled');
  if (!requiredGates.nonDryRunProviderSelected) blockers.push('live_provider_not_selected');

  return {
    ok: true,
    mode: 'sending-readiness-safe-gate',
    readyForRealDelivery: false,
    provider,
    providerValidation,
    domainReadiness,
    requiredGates,
    blockers,
    nextSafeStep: blockers.length > 0 ? 'resolve_blockers_then_repeat_controlled_dry_run' : 'manual_controlled_live_test_requires_explicit_human_approval',
    realDeliveryAllowed: false
  };
};

const increment = (counts, key) => {
  counts[key] = (counts[key] || 0) + 1;
};

export const campaignReportingSummary = () => {
  const campaignList = listCampaigns();
  const queue = listSendQueue();
  const emailEvents = listEmailEvents();
  const suppressions = listSuppressions();
  const rows = campaignList.campaigns.map((campaign) => {
    const jobs = queue.jobs.filter((job) => job.campaignId === campaign.id);
    const events = emailEvents.events.filter((event) => event.campaignId === campaign.id);
    const eventCounts = events.reduce((counts, event) => {
      increment(counts, event.type);
      return counts;
    }, {});
    const unsubscribeSuppressions = suppressions.suppressions.filter((suppression) => suppression.reason === 'unsubscribe' && suppression.source === `campaign:${campaign.id}`);

    return {
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      estimatedAudience: campaign.estimatedAudience,
      queuedDryRuns: jobs.filter((job) => job.status === 'queued_dry_run').length,
      dispatchedDryRuns: jobs.filter((job) => job.status === 'dispatched_dry_run').length,
      events: eventCounts,
      unsubscribes: unsubscribeSuppressions.length,
      realDeliveryAllowed: false
    };
  });

  return {
    ok: true,
    mode: 'campaign-reporting-safe-summary',
    count: rows.length,
    campaigns: rows,
    realDeliveryAllowed: false
  };
};

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
    sendingReadiness: sendingReadinessSummary(env),
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
        unsubscribe: 'tracked_link_records_suppression',
        dispatchEvents: 'dry_run_dispatch_records_event',
        bounceComplaint: 'manual_ingest_records_event_and_suppression',
        rateLimits: 'dry_run_warmup_enforced',
        audit: 'baseline_in_memory',
        sendingReadiness: 'explicit_safe_gate_endpoint',
        senderDomain: 'safe_readiness_gate_no_dns_probe'
      }
    }
  };
};
