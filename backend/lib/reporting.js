import { listAuditLog } from './auditLog.js';
import { listCampaigns } from './campaigns.js';
import { listContacts } from './contacts.js';
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

const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || 'unknown';

const rate = (numerator, denominator) => denominator > 0 ? numerator / denominator : 0;

const eventCountsFor = (events) => events.reduce((counts, event) => {
  increment(counts, event.type);
  return counts;
}, {});

const sourceForEmail = (contactByEmail, email) => contactByEmail.get(String(email || '').toLowerCase())?.source || 'unknown';

const addRollup = (map, key, event, contactByEmail) => {
  const row = map.get(key) || {
    key,
    contacts: 0,
    events: 0,
    dispatched: 0,
    delivered: 0,
    deferred: 0,
    bounces: 0,
    complaints: 0,
    opens: 0,
    clicks: 0,
    unsubscribes: 0
  };
  row.events += 1;
  if (event.type === 'dispatched') row.dispatched += 1;
  if (event.type === 'delivered') row.delivered += 1;
  if (event.type === 'deferred') row.deferred += 1;
  if (event.type === 'bounce') row.bounces += 1;
  if (event.type === 'complaint') row.complaints += 1;
  if (event.type === 'open') row.opens += 1;
  if (event.type === 'click') row.clicks += 1;
  map.set(key, row);
};

const finishRollup = (row) => ({
  ...row,
  openRate: rate(row.opens, Math.max(row.dispatched, row.delivered, 1)),
  clickRate: rate(row.clicks, Math.max(row.dispatched, row.delivered, 1)),
  bounceRate: rate(row.bounces, Math.max(row.dispatched, row.delivered, row.bounces, 1)),
  complaintRate: rate(row.complaints, Math.max(row.dispatched, row.delivered, row.complaints, 1)),
  riskLevel: row.complaints > 0 || row.bounceRate > 0.05 ? 'high' : (row.deferred > 0 || row.bounceRate > 0.02 ? 'watch' : 'normal'),
  realDeliveryAllowed: false
});

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
      affiliate: campaign.affiliate || {
        affiliateProgram: campaign.affiliateProgram || null,
        affiliateOfferId: campaign.affiliateOfferId || null,
        payoutModel: campaign.payoutModel || null,
        trackingTemplateConfigured: Boolean(campaign.trackingTemplate),
        utmSource: campaign.utmSource || null,
        utmCampaign: campaign.utmCampaign || null,
        realDeliveryAllowed: false
      },
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

export const reportingDashboardDepth = (env = process.env) => {
  const contacts = listContacts();
  const campaigns = campaignReportingSummary();
  const events = listEmailEvents();
  const suppressions = listSuppressions();
  const queue = listSendQueue();
  const contactByEmail = new Map((contacts.contacts || []).map((contact) => [String(contact.email || '').toLowerCase(), contact]));
  const sourceContactCounts = new Map();
  const domainContactCounts = new Map();
  (contacts.contacts || []).forEach((contact) => {
    sourceContactCounts.set(contact.source || 'unknown', (sourceContactCounts.get(contact.source || 'unknown') || 0) + 1);
    domainContactCounts.set(domainOf(contact.email), (domainContactCounts.get(domainOf(contact.email)) || 0) + 1);
  });

  const sourceMap = new Map();
  const domainMap = new Map();
  const trendMap = new Map();
  (events.events || []).forEach((event) => {
    addRollup(sourceMap, sourceForEmail(contactByEmail, event.email), event, contactByEmail);
    addRollup(domainMap, domainOf(event.email), event, contactByEmail);
    const day = String(event.createdAt || new Date().toISOString()).slice(0, 10);
    addRollup(trendMap, day, event, contactByEmail);
  });
  sourceContactCounts.forEach((count, source) => {
    const row = sourceMap.get(source) || { key: source, contacts: 0, events: 0, dispatched: 0, delivered: 0, deferred: 0, bounces: 0, complaints: 0, opens: 0, clicks: 0, unsubscribes: 0 };
    row.contacts = count;
    sourceMap.set(source, row);
  });
  domainContactCounts.forEach((count, domain) => {
    const row = domainMap.get(domain) || { key: domain, contacts: 0, events: 0, dispatched: 0, delivered: 0, deferred: 0, bounces: 0, complaints: 0, opens: 0, clicks: 0, unsubscribes: 0 };
    row.contacts = count;
    domainMap.set(domain, row);
  });
  (suppressions.suppressions || []).forEach((suppression) => {
    const source = sourceForEmail(contactByEmail, suppression.email);
    const sourceRow = sourceMap.get(source) || { key: source, contacts: 0, events: 0, dispatched: 0, delivered: 0, deferred: 0, bounces: 0, complaints: 0, opens: 0, clicks: 0, unsubscribes: 0 };
    sourceRow.unsubscribes += suppression.reason === 'unsubscribe' ? 1 : 0;
    sourceMap.set(source, sourceRow);
    const domain = domainOf(suppression.email);
    const domainRow = domainMap.get(domain) || { key: domain, contacts: 0, events: 0, dispatched: 0, delivered: 0, deferred: 0, bounces: 0, complaints: 0, opens: 0, clicks: 0, unsubscribes: 0 };
    domainRow.unsubscribes += suppression.reason === 'unsubscribe' ? 1 : 0;
    domainMap.set(domain, domainRow);
  });

  const sourcePerformance = [...sourceMap.values()].map(finishRollup).sort((a, b) => (b.events + b.contacts) - (a.events + a.contacts)).slice(0, 12);
  const domainPerformance = [...domainMap.values()].map(finishRollup).sort((a, b) => (b.events + b.contacts) - (a.events + a.contacts)).slice(0, 12);
  const trends = [...trendMap.values()].map(finishRollup).sort((a, b) => a.key.localeCompare(b.key)).slice(-30);
  const campaignLeaderboard = campaigns.campaigns.map((campaign) => ({
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
    affiliate: campaign.affiliate,
    realDeliveryAllowed: false
  })).sort((a, b) => (b.opens + b.clicks) - (a.opens + a.clicks)).slice(0, 10);
  const eventCounts = eventCountsFor(events.events || []);
  const queuedByStatus = (queue.jobs || []).reduce((counts, job) => {
    increment(counts, job.status || 'unknown');
    return counts;
  }, {});

  return {
    ok: true,
    mode: 'reporting-dashboard-depth-safe-summary',
    generatedAt: new Date().toISOString(),
    cards: {
      contacts: contacts.count || 0,
      campaigns: campaigns.count || 0,
      sendJobs: queue.count || 0,
      events: events.count || 0,
      suppressions: suppressions.count || 0,
      opens: eventCounts.open || 0,
      clicks: eventCounts.click || 0,
      bounces: eventCounts.bounce || 0,
      complaints: eventCounts.complaint || 0,
      realDeliveryAllowed: false
    },
    eventCounts,
    queueStatus: queuedByStatus,
    campaignLeaderboard,
    sourcePerformance,
    domainPerformance,
    trends,
    exports: ['summary', 'campaigns', 'events', 'suppressions'],
    safety: {
      adminSessionRequired: true,
      noSecretsIncluded: true,
      noExternalDelivery: true,
      noNetworkProbe: true,
      aggregateOnly: true,
      affiliateMetadataOnly: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};

const normalizeDrilldownDimension = (value) => {
  const clean = String(value || 'source').trim().toLowerCase();
  return ['campaign', 'source', 'domain', 'trend'].includes(clean) ? clean : 'source';
};

export const reportingDashboardDrilldown = ({ dimension = 'source', key = '' } = {}) => {
  const cleanDimension = normalizeDrilldownDimension(dimension);
  const dashboard = reportingDashboardDepth();
  const contacts = listContacts();
  const events = listEmailEvents();
  const suppressions = listSuppressions();
  const campaigns = campaignReportingSummary();
  const contactByEmail = new Map((contacts.contacts || []).map((contact) => [String(contact.email || '').toLowerCase(), contact]));
  const fallbackKey = cleanDimension === 'campaign'
    ? dashboard.campaignLeaderboard[0]?.campaignId
    : cleanDimension === 'domain'
      ? dashboard.domainPerformance[0]?.key
      : cleanDimension === 'trend'
        ? dashboard.trends[dashboard.trends.length - 1]?.key
        : dashboard.sourcePerformance[0]?.key;
  const selectedKey = String(key || fallbackKey || '').trim();

  const matchesEvent = (event) => {
    if (cleanDimension === 'campaign') return String(event.campaignId || '') === selectedKey;
    if (cleanDimension === 'domain') return domainOf(event.email) === selectedKey;
    if (cleanDimension === 'trend') return String(event.createdAt || '').slice(0, 10) === selectedKey;
    return sourceForEmail(contactByEmail, event.email) === selectedKey;
  };
  const matchesContact = (contact) => {
    if (cleanDimension === 'domain') return domainOf(contact.email) === selectedKey;
    if (cleanDimension === 'source') return String(contact.source || 'unknown') === selectedKey;
    return false;
  };
  const matchingEvents = (events.events || []).filter(matchesEvent);
  const matchingContacts = (contacts.contacts || []).filter(matchesContact);
  const matchingSuppressions = (suppressions.suppressions || []).filter((suppression) => {
    if (cleanDimension === 'domain') return domainOf(suppression.email) === selectedKey;
    if (cleanDimension === 'source') return sourceForEmail(contactByEmail, suppression.email) === selectedKey;
    if (cleanDimension === 'campaign') return String(suppression.source || '').includes(selectedKey);
    if (cleanDimension === 'trend') return String(suppression.createdAt || '').slice(0, 10) === selectedKey;
    return false;
  });
  const counts = eventCountsFor(matchingEvents);
  const denominator = Math.max(counts.dispatched || 0, counts.delivered || 0, matchingEvents.length, matchingContacts.length, 1);
  const trendMap = new Map();
  matchingEvents.forEach((event) => {
    const day = String(event.createdAt || new Date().toISOString()).slice(0, 10);
    addRollup(trendMap, day, event, contactByEmail);
  });
  const campaignBreakdown = campaigns.campaigns
    .filter((campaign) => cleanDimension !== 'campaign' || campaign.campaignId === selectedKey)
    .map((campaign) => ({
      campaignId: campaign.campaignId,
      name: campaign.name,
      status: campaign.status,
      opens: campaign.engagement.opens,
      clicks: campaign.engagement.clicks,
      openRate: campaign.engagement.openRate,
      clickRate: campaign.engagement.clickRate,
      affiliate: campaign.affiliate,
      realDeliveryAllowed: false
    }))
    .slice(0, 10);
  const recommendations = [];
  if ((counts.bounce || 0) > 0 || (counts.complaint || 0) > 0) recommendations.push('review_suppressions_and_source_quality_before_future_schedules');
  if ((counts.deferred || 0) > 0) recommendations.push('watch_recipient_domain_deferrals_before_warmup_increase');
  if ((counts.open || 0) === 0 && (counts.click || 0) === 0 && matchingEvents.length > 0) recommendations.push('low_engagement_review_segment_or_creative');
  if (matchingEvents.length === 0) recommendations.push('no_events_yet_keep_aggregate_only_monitoring');

  return {
    ok: true,
    mode: 'reporting-dashboard-drilldown-safe-summary',
    dimension: cleanDimension,
    key: selectedKey || null,
    counts: {
      contacts: matchingContacts.length,
      events: matchingEvents.length,
      suppressions: matchingSuppressions.length,
      dispatched: counts.dispatched || 0,
      delivered: counts.delivered || 0,
      deferred: counts.deferred || 0,
      opens: counts.open || 0,
      clicks: counts.click || 0,
      bounces: counts.bounce || 0,
      complaints: counts.complaint || 0,
      unsubscribes: counts.unsubscribed || matchingSuppressions.filter((s) => s.reason === 'unsubscribe').length
    },
    rates: {
      openRate: rate(counts.open || 0, denominator),
      clickRate: rate(counts.click || 0, denominator),
      bounceRate: rate(counts.bounce || 0, denominator),
      complaintRate: rate(counts.complaint || 0, denominator)
    },
    campaignBreakdown,
    eventTrend: [...trendMap.values()].map(finishRollup).sort((a, b) => a.key.localeCompare(b.key)).slice(-14),
    sampleEvents: matchingEvents.slice(-10).map((event) => ({
      type: event.type,
      emailDomain: domainOf(event.email),
      source: sourceForEmail(contactByEmail, event.email),
      campaignId: event.campaignId || null,
      providerMessageIdPresent: Boolean(event.providerMessageId),
      createdAt: event.createdAt,
      realDeliveryAllowed: false
    })),
    recommendations,
    safety: {
      adminSessionRequired: true,
      readOnly: true,
      aggregateOnly: true,
      noSecretsIncluded: true,
      noExternalDelivery: true,
      noNetworkProbe: true,
      noQueueMutation: true,
      noProviderMutation: true,
      realDeliveryAllowed: false
    },
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
