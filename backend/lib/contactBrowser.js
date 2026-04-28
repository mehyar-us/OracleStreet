import { listContacts } from './contacts.js';
import { listEmailEvents } from './emailEvents.js';
import { listSendQueue } from './sendQueue.js';
import { listSuppressions } from './suppressions.js';

const ROLE_PREFIXES = new Set(['admin', 'abuse', 'billing', 'compliance', 'contact', 'help', 'info', 'marketing', 'noreply', 'no-reply', 'postmaster', 'sales', 'security', 'support', 'webmaster']);
const nowMs = () => Date.now();
const domainOf = (email) => String(email || '').split('@')[1]?.toLowerCase() || '';
const localPartOf = (email) => String(email || '').split('@')[0]?.toLowerCase() || '';
const clean = (value) => String(value || '').trim().toLowerCase();

const contactName = (contact) => [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();

const isStale = (contact, staleAfterDays, now = nowMs()) => {
  const stamp = Date.parse(contact.updatedAt || contact.createdAt || '');
  if (!Number.isFinite(stamp)) return false;
  return now - stamp > staleAfterDays * 24 * 60 * 60 * 1000;
};

const riskFlagsFor = (contact, suppression, events, staleAfterDays) => {
  const flags = [];
  if (suppression) flags.push(`suppressed:${suppression.reason}`);
  if (ROLE_PREFIXES.has(localPartOf(contact.email))) flags.push('role_account');
  if (!contact.source) flags.push('missing_source');
  if (!['opt_in', 'double_opt_in'].includes(contact.consentStatus)) flags.push('missing_explicit_consent');
  if (isStale(contact, staleAfterDays)) flags.push('stale_contact');
  if (events.some((event) => event.type === 'bounce')) flags.push('has_bounce_event');
  if (events.some((event) => event.type === 'complaint')) flags.push('has_complaint_event');
  return flags;
};

const sourceScore = ({ total, suppressed, risky, stale, bounced, complained }) => {
  if (!total) return 100;
  const penalty = Math.min(80,
    Math.round((suppressed / total) * 25) +
    Math.round((risky / total) * 25) +
    Math.round((stale / total) * 15) +
    Math.round((bounced / total) * 25) +
    Math.round((complained / total) * 35)
  );
  return Math.max(0, 100 - penalty);
};

export const browseContacts = ({ search = '', status = '', consentStatus = '', source = '', domain = '', suppression = '', risk = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const contactsResult = listContacts();
  const suppressionsResult = listSuppressions();
  const eventsResult = listEmailEvents();
  const queueResult = listSendQueue();

  const suppressionsByEmail = new Map((suppressionsResult.suppressions || []).map((entry) => [clean(entry.email), entry]));
  const eventsByEmail = new Map();
  for (const event of eventsResult.events || []) {
    const key = clean(event.email);
    if (!eventsByEmail.has(key)) eventsByEmail.set(key, []);
    eventsByEmail.get(key).push(event);
  }
  const jobsByEmail = new Map();
  for (const job of queueResult.jobs || []) {
    const key = clean(job.to || job.email);
    if (!eventsByEmail.has(key)) eventsByEmail.set(key, eventsByEmail.get(key) || []);
    if (!jobsByEmail.has(key)) jobsByEmail.set(key, []);
    jobsByEmail.get(key).push(job);
  }

  const staleDays = Math.max(1, Math.min(3650, Number(staleAfterDays) || 180));
  const rowLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const searchTerm = clean(search);
  const statusFilter = clean(status);
  const consentFilter = clean(consentStatus);
  const sourceFilter = clean(source);
  const domainFilter = clean(domain).replace(/^@/, '');
  const suppressionFilter = clean(suppression);
  const riskFilter = clean(risk);

  const decorated = (contactsResult.contacts || []).map((contact) => {
    const email = clean(contact.email);
    const suppressionEntry = suppressionsByEmail.get(email) || null;
    const contactEvents = eventsByEmail.get(email) || [];
    const contactJobs = jobsByEmail.get(email) || [];
    const flags = riskFlagsFor(contact, suppressionEntry, contactEvents, staleDays);
    return {
      ...contact,
      domain: domainOf(contact.email),
      name: contactName(contact),
      suppressed: Boolean(suppressionEntry),
      suppression: suppressionEntry,
      riskFlags: flags,
      eventCounts: contactEvents.reduce((counts, event) => ({ ...counts, [event.type]: (counts[event.type] || 0) + 1 }), {}),
      timeline: [
        { type: 'contact_imported', at: contact.createdAt || null, source: contact.source || null },
        ...contactEvents.slice(0, 10).map((event) => ({ type: `event:${event.type}`, at: event.createdAt || null, source: event.source || null, id: event.id || null })),
        ...contactJobs.slice(0, 10).map((job) => ({ type: `send_job:${job.status}`, at: job.createdAt || null, source: job.source || null, id: job.id || null }))
      ].filter((item) => item.at || item.source || item.id)
    };
  });

  const filtered = decorated.filter((contact) => {
    if (searchTerm) {
      const haystack = [contact.email, contact.name, contact.source, contact.sourceDetail, contact.domain, contact.status].map(clean).join(' ');
      if (!haystack.includes(searchTerm)) return false;
    }
    if (statusFilter && clean(contact.status) !== statusFilter) return false;
    if (consentFilter && clean(contact.consentStatus) !== consentFilter) return false;
    if (sourceFilter && !clean(contact.source).includes(sourceFilter)) return false;
    if (domainFilter && contact.domain !== domainFilter) return false;
    if (suppressionFilter === 'suppressed' && !contact.suppressed) return false;
    if (suppressionFilter === 'not_suppressed' && contact.suppressed) return false;
    if (riskFilter === 'risky' && contact.riskFlags.length === 0) return false;
    if (riskFilter === 'stale' && !contact.riskFlags.includes('stale_contact')) return false;
    if (riskFilter === 'role_account' && !contact.riskFlags.includes('role_account')) return false;
    return true;
  });

  const sources = new Map();
  const domains = new Map();
  for (const contact of decorated) {
    const sourceKey = contact.source || 'unknown_source';
    const domainKey = contact.domain || 'unknown_domain';
    const sourceStats = sources.get(sourceKey) || { source: sourceKey, total: 0, suppressed: 0, risky: 0, stale: 0, bounced: 0, complained: 0 };
    const domainStats = domains.get(domainKey) || { domain: domainKey, total: 0, suppressed: 0, risky: 0, stale: 0 };
    sourceStats.total += 1;
    domainStats.total += 1;
    if (contact.suppressed) { sourceStats.suppressed += 1; domainStats.suppressed += 1; }
    if (contact.riskFlags.length) { sourceStats.risky += 1; domainStats.risky += 1; }
    if (contact.riskFlags.includes('stale_contact')) { sourceStats.stale += 1; domainStats.stale += 1; }
    if (contact.eventCounts.bounce) sourceStats.bounced += contact.eventCounts.bounce;
    if (contact.eventCounts.complaint) sourceStats.complained += contact.eventCounts.complaint;
    sources.set(sourceKey, sourceStats);
    domains.set(domainKey, domainStats);
  }

  const sourceQuality = [...sources.values()].map((entry) => ({ ...entry, score: sourceScore(entry) })).sort((a, b) => a.score - b.score || b.total - a.total).slice(0, 25);
  const domainConcentration = [...domains.values()].map((entry) => ({ ...entry, share: decorated.length ? entry.total / decorated.length : 0 })).sort((a, b) => b.total - a.total).slice(0, 25);

  return {
    ok: true,
    mode: 'contact-browser-search-filter-drilldown',
    filters: { search: searchTerm, status: statusFilter, consentStatus: consentFilter, source: sourceFilter, domain: domainFilter, suppression: suppressionFilter, risk: riskFilter, staleAfterDays: staleDays, limit: rowLimit },
    totals: {
      totalContacts: decorated.length,
      matchedContacts: filtered.length,
      suppressedContacts: decorated.filter((contact) => contact.suppressed).length,
      riskyContacts: decorated.filter((contact) => contact.riskFlags.length > 0).length,
      staleContacts: decorated.filter((contact) => contact.riskFlags.includes('stale_contact')).length,
      sources: sources.size,
      domains: domains.size
    },
    contacts: filtered.slice(0, rowLimit),
    sourceQuality,
    domainConcentration,
    safety: {
      adminOnly: true,
      noContactMutation: true,
      noSuppressionMutation: true,
      noNetworkProbe: true,
      realDeliveryAllowed: false
    },
    persistenceMode: contactsResult.persistenceMode
  };
};

export const contactDetailDrilldown = ({ email = '', id = '', staleAfterDays = 180 } = {}) => {
  const contactsResult = listContacts();
  const suppressionsResult = listSuppressions();
  const eventsResult = listEmailEvents();
  const queueResult = listSendQueue();
  const emailKey = clean(email);
  const idKey = String(id || '').trim();
  const contact = (contactsResult.contacts || []).find((entry) => (emailKey && clean(entry.email) === emailKey) || (idKey && String(entry.id || '') === idKey));
  if (!contact) {
    return {
      ok: false,
      mode: 'contact-detail-drilldown',
      error: 'contact_not_found',
      contact: null,
      realDeliveryAllowed: false
    };
  }
  const targetEmail = clean(contact.email);
  const suppression = (suppressionsResult.suppressions || []).find((entry) => clean(entry.email) === targetEmail) || null;
  const events = (eventsResult.events || []).filter((event) => clean(event.email) === targetEmail);
  const jobs = (queueResult.jobs || []).filter((job) => clean(job.to || job.email) === targetEmail);
  const staleDays = Math.max(1, Math.min(3650, Number(staleAfterDays) || 180));
  const riskFlags = riskFlagsFor(contact, suppression, events, staleDays);
  const eventCounts = events.reduce((counts, event) => ({ ...counts, [event.type]: (counts[event.type] || 0) + 1 }), {});
  const queueCounts = jobs.reduce((counts, job) => ({ ...counts, [job.status || 'unknown']: (counts[job.status || 'unknown'] || 0) + 1 }), {});
  const timeline = [
    { type: 'contact_imported', at: contact.createdAt || null, source: contact.source || null, id: contact.id || null },
    ...events.map((event) => ({ type: `event:${event.type}`, at: event.createdAt || null, source: event.source || null, campaignId: event.campaignId || null, providerMessageIdPresent: Boolean(event.providerMessageId), id: event.id || null })),
    ...jobs.map((job) => ({ type: `send_job:${job.status}`, at: job.createdAt || null, campaignId: job.campaignId || null, id: job.id || null }))
  ].filter((entry) => entry.at || entry.source || entry.id || entry.campaignId)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 25);
  const recommendations = [];
  if (suppression) recommendations.push('keep_suppressed_until_manual_review_confirms_repermission');
  if (riskFlags.includes('role_account')) recommendations.push('review_role_account_before_campaign_audience_use');
  if (riskFlags.includes('stale_contact')) recommendations.push('refresh_consent_before_future_campaign_scheduling');
  if (eventCounts.bounce || eventCounts.complaint) recommendations.push('exclude_from_future_sends_and_review_source_quality');
  if (!recommendations.length) recommendations.push('contact_currently_clear_for_dry_run_planning_only');

  return {
    ok: true,
    mode: 'contact-detail-drilldown',
    contact: {
      id: contact.id || null,
      email: contact.email,
      domain: domainOf(contact.email),
      name: contactName(contact),
      source: contact.source || null,
      sourceDetail: contact.sourceDetail || null,
      consentStatus: contact.consentStatus || null,
      status: contact.status || null,
      createdAt: contact.createdAt || null,
      updatedAt: contact.updatedAt || null,
      suppressed: Boolean(suppression),
      suppressionReason: suppression?.reason || null,
      riskFlags
    },
    eventCounts,
    queueCounts,
    timeline,
    recommendations,
    safety: {
      adminOnly: true,
      readOnly: true,
      noContactMutation: true,
      noSuppressionMutation: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noNetworkProbe: true,
      realDeliveryAllowed: false
    },
    persistenceMode: contactsResult.persistenceMode,
    realDeliveryAllowed: false
  };
};

export const sourceQualityDrilldown = ({ source = '', limit = 50, staleAfterDays = 180 } = {}) => {
  const overview = browseContacts({ staleAfterDays, limit: 500 });
  const selectedSource = String(source || overview.sourceQuality[0]?.source || '').trim();
  const rowLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  if (!selectedSource) {
    return {
      ok: true,
      mode: 'contact-source-quality-drilldown',
      source: null,
      summary: null,
      domainBreakdown: [],
      riskBreakdown: {},
      sampleContacts: [],
      recommendations: ['import_consented_contacts_with_source_metadata_before_reviewing_source_quality'],
      safety: {
        adminOnly: true,
        readOnly: true,
        noContactMutation: true,
        noSuppressionMutation: true,
        noQueueMutation: true,
        noProviderMutation: true,
        noNetworkProbe: true,
        realDeliveryAllowed: false
      },
      persistenceMode: overview.persistenceMode,
      realDeliveryAllowed: false
    };
  }

  const drilldown = browseContacts({ source: selectedSource, staleAfterDays, limit: 500 });
  const contacts = drilldown.contacts || [];
  const summary = overview.sourceQuality.find((entry) => clean(entry.source) === clean(selectedSource)) || {
    source: selectedSource,
    total: contacts.length,
    suppressed: contacts.filter((contact) => contact.suppressed).length,
    risky: contacts.filter((contact) => contact.riskFlags?.length).length,
    stale: contacts.filter((contact) => contact.riskFlags?.includes('stale_contact')).length,
    bounced: contacts.reduce((sum, contact) => sum + (contact.eventCounts?.bounce || 0), 0),
    complained: contacts.reduce((sum, contact) => sum + (contact.eventCounts?.complaint || 0), 0),
    score: sourceScore({ total: contacts.length, suppressed: 0, risky: 0, stale: 0, bounced: 0, complained: 0 })
  };
  const domainMap = new Map();
  const riskBreakdown = {};
  for (const contact of contacts) {
    const domain = contact.domain || 'unknown_domain';
    const row = domainMap.get(domain) || { domain, total: 0, suppressed: 0, risky: 0, bounced: 0, complained: 0 };
    row.total += 1;
    if (contact.suppressed) row.suppressed += 1;
    if (contact.riskFlags?.length) row.risky += 1;
    row.bounced += contact.eventCounts?.bounce || 0;
    row.complained += contact.eventCounts?.complaint || 0;
    domainMap.set(domain, row);
    for (const flag of contact.riskFlags || []) riskBreakdown[flag] = (riskBreakdown[flag] || 0) + 1;
  }
  const recommendations = [];
  if (summary.suppressed > 0) recommendations.push('review_suppressed_contacts_before_using_this_source_in_segments');
  if (summary.bounced > 0 || summary.complained > 0) recommendations.push('quarantine_or_limit_this_source_until_bounce_complaint_causes_are_reviewed');
  if (summary.stale > 0) recommendations.push('refresh_consent_for_stale_contacts_from_this_source');
  if (summary.score < 70) recommendations.push('require_operator_review_before_campaign_audience_use');
  if (!recommendations.length) recommendations.push('source_currently_clear_for_dry_run_planning_only');

  return {
    ok: true,
    mode: 'contact-source-quality-drilldown',
    source: selectedSource,
    summary,
    domainBreakdown: [...domainMap.values()].sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain)).slice(0, 25),
    riskBreakdown,
    sampleContacts: contacts.slice(0, rowLimit).map((contact) => ({
      id: contact.id || null,
      email: contact.email,
      domain: contact.domain,
      consentStatus: contact.consentStatus,
      suppressed: contact.suppressed,
      riskFlags: contact.riskFlags || [],
      eventCounts: contact.eventCounts || {}
    })),
    recommendations,
    safety: {
      adminOnly: true,
      readOnly: true,
      noContactMutation: true,
      noSuppressionMutation: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noNetworkProbe: true,
      realDeliveryAllowed: false
    },
    persistenceMode: overview.persistenceMode,
    realDeliveryAllowed: false
  };
};

export const sourceHygieneActionPlan = ({ scoreThreshold = 70, staleAfterDays = 180, limit = 25 } = {}) => {
  const overview = browseContacts({ staleAfterDays, limit: 500 });
  const threshold = Math.max(0, Math.min(100, Number(scoreThreshold) || 70));
  const rowLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const plans = (overview.sourceQuality || []).map((source) => {
    const actions = [];
    if (source.score < threshold) actions.push('require_operator_review_before_segment_use');
    if (source.suppressed > 0) actions.push('exclude_or_review_suppressed_contacts');
    if (source.bounced > 0 || source.complained > 0) actions.push('quarantine_source_until_bounce_complaint_review');
    if (source.stale > 0) actions.push('refresh_stale_consent_before_campaigns');
    if (source.risky > 0) actions.push('sample_risky_contacts_before_campaign_audience_use');
    if (!actions.length) actions.push('safe_for_dry_run_segment_planning_only');
    const priority = source.complained > 0 || source.score < 50
      ? 'high'
      : source.bounced > 0 || source.suppressed > 0 || source.score < threshold
        ? 'medium'
        : 'low';
    return {
      source: source.source,
      score: source.score,
      priority,
      total: source.total,
      suppressed: source.suppressed,
      risky: source.risky,
      stale: source.stale,
      bounced: source.bounced,
      complained: source.complained,
      actions,
      reviewGate: priority !== 'low',
      deliveryAllowed: false
    };
  }).sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.priority] - rank[b.priority] || a.score - b.score || b.total - a.total;
  }).slice(0, rowLimit);

  return {
    ok: true,
    mode: 'contact-source-hygiene-action-plan',
    scoreThreshold: threshold,
    totals: {
      sourcesReviewed: overview.sourceQuality?.length || 0,
      highPrioritySources: plans.filter((plan) => plan.priority === 'high').length,
      mediumPrioritySources: plans.filter((plan) => plan.priority === 'medium').length,
      lowPrioritySources: plans.filter((plan) => plan.priority === 'low').length,
      reviewGates: plans.filter((plan) => plan.reviewGate).length
    },
    plans,
    recommendations: plans.length
      ? plans.filter((plan) => plan.reviewGate).map((plan) => `review_${plan.source}_before_campaign_audience_use`).slice(0, 10)
      : ['import_consented_contacts_with_source_metadata_before_source_hygiene_planning'],
    safety: {
      adminOnly: true,
      readOnly: true,
      recommendationOnly: true,
      noContactMutation: true,
      noSuppressionMutation: true,
      noSegmentMutation: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noNetworkProbe: true,
      realDeliveryAllowed: false
    },
    persistenceMode: overview.persistenceMode,
    realDeliveryAllowed: false
  };
};
