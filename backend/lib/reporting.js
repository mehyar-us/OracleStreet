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

    const queuedDryRuns = jobs.filter((job) => job.status === 'queued_dry_run').length;
    const dispatchedDryRuns = jobs.filter((job) => job.status === 'dispatched_dry_run').length;
    const denominator = Math.max(dispatchedDryRuns, queuedDryRuns, campaign.estimatedAudience || 0, 1);

    return {
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      estimatedAudience: campaign.estimatedAudience,
      queuedDryRuns,
      dispatchedDryRuns,
      events: eventCounts,
      engagement: {
        opens: eventCounts.open || 0,
        clicks: eventCounts.click || 0,
        openRate: (eventCounts.open || 0) / denominator,
        clickRate: (eventCounts.click || 0) / denominator,
        denominator,
        deliveryMode: 'dry-run-events-only'
      },
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
      dispatched: eventCounts.dispatched || 0,
      delivered: eventCounts.delivered || 0,
      deferred: eventCounts.deferred || 0,
      opens: eventCounts.open || 0,
      clicks: eventCounts.click || 0
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
        deliveryEvents: 'manual_delivery_ingest_records_delivered_deferred_without_suppression',
        engagementTracking: 'tracked_open_click_records_event_without_delivery',
        bounceComplaint: 'manual_ingest_records_event_and_suppression',
        rateLimits: 'dry_run_warmup_enforced',
        audit: 'baseline_in_memory',
        sendingReadiness: 'explicit_safe_gate_endpoint',
        senderDomain: 'safe_readiness_gate_no_dns_probe'
      }
    }
  };
};

const csvEscape = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toCsv = (headers, rows) => [
  headers.join(','),
  ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
].join('\n');

export const reportingExportPreview = ({ dataset = 'campaigns', actorEmail = null } = {}, env = process.env) => {
  const cleanDataset = String(dataset || '').trim().toLowerCase();
  if (!['summary', 'campaigns', 'events', 'suppressions'].includes(cleanDataset)) {
    return { ok: false, errors: ['valid_export_dataset_required'], realDeliveryAllowed: false, rowsExported: 0 };
  }

  let headers = [];
  let rows = [];
  if (cleanDataset === 'summary') {
    const report = emailReportingSummary(env);
    headers = ['metric', 'value'];
    rows = Object.entries(report.totals).map(([metric, value]) => ({ metric, value }));
  }
  if (cleanDataset === 'campaigns') {
    const report = campaignReportingSummary();
    headers = ['campaignId', 'name', 'status', 'estimatedAudience', 'queuedDryRuns', 'dispatchedDryRuns', 'opens', 'clicks', 'openRate', 'clickRate', 'unsubscribes', 'realDeliveryAllowed'];
    rows = report.campaigns.map((campaign) => ({
      campaignId: campaign.campaignId,
      name: campaign.name,
      status: campaign.status,
      estimatedAudience: campaign.estimatedAudience,
      queuedDryRuns: campaign.queuedDryRuns,
      dispatchedDryRuns: campaign.dispatchedDryRuns,
      opens: campaign.engagement.opens,
      clicks: campaign.engagement.clicks,
      openRate: campaign.engagement.openRate,
      clickRate: campaign.engagement.clickRate,
      unsubscribes: campaign.unsubscribes,
      realDeliveryAllowed: false
    }));
  }
  if (cleanDataset === 'events') {
    const report = listEmailEvents();
    headers = ['id', 'type', 'email', 'campaignId', 'contactId', 'providerMessageId', 'source', 'createdAt'];
    rows = report.events.map((event) => ({
      id: event.id,
      type: event.type,
      email: event.email,
      campaignId: event.campaignId,
      contactId: event.contactId,
      providerMessageId: event.providerMessageId,
      source: event.source,
      createdAt: event.createdAt
    }));
  }
  if (cleanDataset === 'suppressions') {
    const report = listSuppressions();
    headers = ['id', 'email', 'reason', 'source', 'actorEmail', 'createdAt', 'updatedAt'];
    rows = report.suppressions.map((suppression) => ({
      id: suppression.id,
      email: suppression.email,
      reason: suppression.reason,
      source: suppression.source,
      actorEmail: suppression.actorEmail,
      createdAt: suppression.createdAt,
      updatedAt: suppression.updatedAt
    }));
  }

  return {
    ok: true,
    mode: 'reporting-export-safe-preview',
    dataset: cleanDataset,
    format: 'csv',
    filename: `oraclestreet-${cleanDataset}-export.csv`,
    headers,
    rowsExported: rows.length,
    csv: toCsv(headers, rows),
    safety: {
      adminSessionRequired: true,
      noSecretsIncluded: true,
      noExternalDelivery: true,
      noNetworkProbe: true,
      realDeliveryAllowed: false
    },
    actorEmail,
    createdAt: new Date().toISOString(),
    realDeliveryAllowed: false
  };
};
