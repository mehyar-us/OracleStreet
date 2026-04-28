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


const csvEscape = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const contactBrowserExportPreview = (filters = {}) => {
  const result = browseContacts({ ...filters, limit: Math.min(500, Number(filters.limit) || 100) });
  const rows = (result.contacts || []).map((contact) => ({
    email: contact.email,
    name: contact.name || '',
    source: contact.source || '',
    consentStatus: contact.consentStatus || '',
    domain: contact.domain || '',
    suppressed: contact.suppressed ? 'yes' : 'no',
    riskFlags: (contact.riskFlags || []).join('|'),
    createdAt: contact.createdAt || '',
    updatedAt: contact.updatedAt || ''
  }));
  const headers = ['email', 'name', 'source', 'consentStatus', 'domain', 'suppressed', 'riskFlags', 'createdAt', 'updatedAt'];
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n');
  return {
    ok: true,
    mode: 'contact-browser-export-preview',
    filters: result.filters,
    totals: result.totals,
    filename: `oraclestreet-contact-browser-preview-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: rows.length,
    columns: headers,
    previewRows: rows.slice(0, 25),
    csvPreview: csv.split('\n').slice(0, 26).join('\n'),
    exportMutation: false,
    safety: {
      adminOnly: true,
      readOnly: true,
      noContactMutation: true,
      noSuppressionMutation: true,
      noSegmentMutation: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noSecretOutput: true,
      noNetworkProbe: true,
      realDeliveryAllowed: false
    },
    persistenceMode: result.persistenceMode,
    realDeliveryAllowed: false
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

export const sourceQualityMatrix = ({ source = '', domain = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const browser = browseContacts({ source, domain, staleAfterDays, limit: 500 });
  const contacts = browser.contacts || [];
  const rowLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const sourceFilter = clean(source);
  const domainFilter = clean(domain).replace(/^@/, '');
  const cells = new Map();
  const sourceRows = new Map();
  const domainRows = new Map();
  const riskRows = new Map();

  const inc = (map, key, seed, contact) => {
    const row = map.get(key) || { ...seed, total: 0, ready: 0, blocked: 0, suppressed: 0, stale: 0, roleAccounts: 0, bounced: 0, complained: 0 };
    row.total += 1;
    const flags = contact.riskFlags || [];
    const blocked = contact.suppressed || flags.length > 0 || !['opt_in', 'double_opt_in'].includes(contact.consentStatus);
    if (!blocked) row.ready += 1;
    if (blocked) row.blocked += 1;
    if (contact.suppressed) row.suppressed += 1;
    if (flags.includes('stale_contact')) row.stale += 1;
    if (flags.includes('role_account')) row.roleAccounts += 1;
    row.bounced += contact.eventCounts?.bounce || 0;
    row.complained += contact.eventCounts?.complaint || 0;
    map.set(key, row);
    return row;
  };

  for (const contact of contacts) {
    const sourceKey = contact.source || 'unknown_source';
    const domainKey = contact.domain || domainOf(contact.email) || 'unknown_domain';
    const cellKey = `${sourceKey}\u0000${domainKey}`;
    inc(cells, cellKey, { source: sourceKey, domain: domainKey }, contact);
    inc(sourceRows, sourceKey, { source: sourceKey }, contact);
    inc(domainRows, domainKey, { domain: domainKey }, contact);
    for (const flag of contact.riskFlags || []) {
      const row = riskRows.get(flag) || { riskFlag: flag, total: 0, sources: new Set(), domains: new Set() };
      row.total += 1;
      row.sources.add(sourceKey);
      row.domains.add(domainKey);
      riskRows.set(flag, row);
    }
  }

  const finish = (row) => ({
    ...row,
    readyRate: row.total ? row.ready / row.total : 0,
    riskRate: row.total ? row.blocked / row.total : 0,
    score: sourceScore({ total: row.total, suppressed: row.suppressed, risky: row.blocked, stale: row.stale, bounced: row.bounced, complained: row.complained }),
    reviewGate: row.blocked > 0 || row.bounced > 0 || row.complained > 0,
    recommendation: row.blocked > 0 || row.bounced > 0 || row.complained > 0
      ? 'review_or_exclude_this_source_domain_cell_before_segment_snapshot_or_campaign_use'
      : 'ready_for_dry_run_segment_planning_only',
    realDeliveryAllowed: false
  });

  const matrix = [...cells.values()].map(finish).sort((a, b) => b.blocked - a.blocked || a.score - b.score || b.total - a.total).slice(0, rowLimit);
  const recommendations = [];
  if (matrix.some((row) => row.reviewGate)) recommendations.push('review_high_risk_source_domain_cells_before_creating_campaign_audiences');
  if (matrix.some((row) => row.complained > 0)) recommendations.push('quarantine_sources_with_complaints_until_operator_review');
  if (matrix.some((row) => row.suppressed > 0)) recommendations.push('keep_suppressed_contacts_excluded_from_all_saved_segments_and_snapshots');
  if (!recommendations.length) recommendations.push('source_domain_matrix_clear_for_dry_run_planning_only');

  return {
    ok: true,
    mode: 'contact-source-quality-matrix',
    filters: { source: sourceFilter, domain: domainFilter, staleAfterDays: browser.filters?.staleAfterDays || staleAfterDays, limit: rowLimit },
    totals: {
      contactsReviewed: contacts.length,
      sourceDomainCells: cells.size,
      sources: sourceRows.size,
      domains: domainRows.size,
      reviewGates: matrix.filter((row) => row.reviewGate).length,
      blockedContacts: contacts.filter((contact) => contact.suppressed || (contact.riskFlags || []).length > 0).length
    },
    matrix,
    sourceRows: [...sourceRows.values()].map(finish).sort((a, b) => a.score - b.score || b.total - a.total).slice(0, rowLimit),
    domainRows: [...domainRows.values()].map(finish).sort((a, b) => b.total - a.total || a.score - b.score).slice(0, rowLimit),
    riskRows: [...riskRows.values()].map((row) => ({ riskFlag: row.riskFlag, total: row.total, sources: row.sources.size, domains: row.domains.size })).sort((a, b) => b.total - a.total || a.riskFlag.localeCompare(b.riskFlag)).slice(0, rowLimit),
    recommendations,
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
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};

export const contactAudienceReadinessReview = ({ search = '', source = '', domain = '', consentStatus = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const browser = browseContacts({ search, source, domain, consentStatus, staleAfterDays, limit: 500 });
  const contacts = browser.contacts || [];
  const reviewLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const ready = contacts.filter((contact) => !contact.suppressed && (contact.riskFlags || []).length === 0 && ['opt_in', 'double_opt_in'].includes(contact.consentStatus));
  const blocked = contacts.filter((contact) => contact.suppressed || (contact.riskFlags || []).length > 0 || !['opt_in', 'double_opt_in'].includes(contact.consentStatus));
  const sourceRows = new Map();
  const domainRows = new Map();
  const addRow = (map, key, contact) => {
    const row = map.get(key) || { key, total: 0, ready: 0, blocked: 0, suppressed: 0, stale: 0, risky: 0, roleAccounts: 0 };
    row.total += 1;
    if (!contact.suppressed && (contact.riskFlags || []).length === 0) row.ready += 1;
    if (contact.suppressed || (contact.riskFlags || []).length > 0) row.blocked += 1;
    if (contact.suppressed) row.suppressed += 1;
    if ((contact.riskFlags || []).includes('stale_contact')) row.stale += 1;
    if ((contact.riskFlags || []).length) row.risky += 1;
    if ((contact.riskFlags || []).includes('role_account')) row.roleAccounts += 1;
    map.set(key, row);
  };
  contacts.forEach((contact) => {
    addRow(sourceRows, contact.source || 'unknown_source', contact);
    addRow(domainRows, contact.domain || domainOf(contact.email) || 'unknown_domain', contact);
  });
  const finishRow = (row) => ({
    ...row,
    readyRate: row.total ? row.ready / row.total : 0,
    reviewGate: row.blocked > 0 || row.ready === 0,
    recommendation: row.blocked > 0 ? 'review_blocked_contacts_before_segment_snapshot_or_campaign_use' : 'ready_for_dry_run_segment_snapshot_planning_only',
    realDeliveryAllowed: false
  });
  const recommendations = [];
  if (blocked.length > 0) recommendations.push('resolve_or_exclude_blocked_contacts_before_campaign_audience_use');
  if (contacts.some((contact) => contact.suppressed)) recommendations.push('keep_suppressed_contacts_excluded_from_all_audience_snapshots');
  if (contacts.some((contact) => (contact.riskFlags || []).includes('stale_contact'))) recommendations.push('refresh_stale_consent_before_warmup_or_campaign_scheduling');
  if (contacts.some((contact) => (contact.riskFlags || []).includes('role_account'))) recommendations.push('review_role_accounts_before_any_affiliate_campaign_segment');
  if (!recommendations.length) recommendations.push('audience_ready_for_dry_run_segment_snapshot_review_only');

  return {
    ok: true,
    mode: 'contact-audience-readiness-review',
    filters: browser.filters,
    totals: {
      matchedContacts: contacts.length,
      readyContacts: ready.length,
      blockedContacts: blocked.length,
      suppressedContacts: contacts.filter((contact) => contact.suppressed).length,
      riskyContacts: contacts.filter((contact) => (contact.riskFlags || []).length).length,
      staleContacts: contacts.filter((contact) => (contact.riskFlags || []).includes('stale_contact')).length,
      roleAccounts: contacts.filter((contact) => (contact.riskFlags || []).includes('role_account')).length,
      readyRate: contacts.length ? ready.length / contacts.length : 0
    },
    sourceReadiness: [...sourceRows.values()].map(finishRow).sort((a, b) => b.blocked - a.blocked || a.readyRate - b.readyRate).slice(0, reviewLimit),
    domainReadiness: [...domainRows.values()].map(finishRow).sort((a, b) => b.blocked - a.blocked || b.total - a.total).slice(0, reviewLimit),
    blockedSamples: blocked.slice(0, reviewLimit).map((contact) => ({
      id: contact.id || null,
      email: contact.email,
      source: contact.source || null,
      domain: contact.domain || null,
      consentStatus: contact.consentStatus || null,
      suppressed: Boolean(contact.suppressed),
      riskFlags: contact.riskFlags || [],
      recommendation: contact.suppressed ? 'exclude_suppressed_contact' : ((contact.riskFlags || []).includes('stale_contact') ? 'refresh_consent_or_exclude' : 'operator_review_before_segment_use'),
      realDeliveryAllowed: false
    })),
    recommendations,
    safety: {
      adminOnly: true,
      readOnly: true,
      noContactMutation: true,
      noSuppressionMutation: true,
      noSegmentMutation: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noNetworkProbe: true,
      realDeliveryAllowed: false
    },
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};


export const contactSuppressionReviewPlan = ({ source = '', domain = '', reason = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const browser = browseContacts({ source, domain, suppression: 'suppressed', staleAfterDays, limit: 500 });
  const reasonFilter = clean(reason);
  const reviewLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const suppressed = (browser.contacts || []).filter((contact) => {
    if (!reasonFilter) return true;
    return clean(contact.suppression?.reason).includes(reasonFilter);
  });
  const reasonRows = new Map();
  const sourceRows = new Map();
  const domainRows = new Map();
  const add = (map, key, contact) => {
    const row = map.get(key) || { key, total: 0, bounced: 0, complained: 0, unsubscribed: 0, manual: 0, stale: 0, roleAccounts: 0 };
    row.total += 1;
    const suppressionReason = clean(contact.suppression?.reason || 'unknown');
    if (suppressionReason.includes('bounce')) row.bounced += 1;
    if (suppressionReason.includes('complaint')) row.complained += 1;
    if (suppressionReason.includes('unsubscribe')) row.unsubscribed += 1;
    if (suppressionReason.includes('manual')) row.manual += 1;
    if ((contact.riskFlags || []).includes('stale_contact')) row.stale += 1;
    if ((contact.riskFlags || []).includes('role_account')) row.roleAccounts += 1;
    map.set(key, row);
  };
  for (const contact of suppressed) {
    add(reasonRows, contact.suppression?.reason || 'unknown_reason', contact);
    add(sourceRows, contact.source || 'unknown_source', contact);
    add(domainRows, contact.domain || domainOf(contact.email) || 'unknown_domain', contact);
  }
  const finish = (row) => ({
    ...row,
    reviewGate: true,
    repermissionAllowedAutomatically: false,
    recommendation: row.complained > 0
      ? 'keep_suppressed_and_review_complaint_source_before_any_future_audience_use'
      : row.bounced > 0
        ? 'keep_suppressed_until_bounce_root_cause_and_address_validity_are_reviewed'
        : row.unsubscribed > 0
          ? 'honor_unsubscribe_and_do_not_repermission_without_new_explicit_consent'
          : 'manual_operator_review_required_before_any_status_change',
    realDeliveryAllowed: false
  });
  const recommendations = [];
  if (suppressed.some((contact) => clean(contact.suppression?.reason).includes('complaint'))) recommendations.push('complaints_are_hard_stop_keep_suppressed_and_review_source_quality');
  if (suppressed.some((contact) => clean(contact.suppression?.reason).includes('bounce'))) recommendations.push('bounce_suppressions_require_address_validity_review_before_any_future_repermission');
  if (suppressed.some((contact) => clean(contact.suppression?.reason).includes('unsubscribe'))) recommendations.push('unsubscribes_must_remain_suppressed_without_new_explicit_consent');
  if (!recommendations.length) recommendations.push(suppressed.length ? 'manual_review_required_before_any_suppression_status_change' : 'no_suppressed_contacts_match_current_filters');

  return {
    ok: true,
    mode: 'contact-suppression-review-plan',
    filters: { ...browser.filters, suppressionReason: reasonFilter, limit: reviewLimit },
    totals: {
      suppressedContacts: suppressed.length,
      reasons: reasonRows.size,
      sources: sourceRows.size,
      domains: domainRows.size,
      complaints: suppressed.filter((contact) => clean(contact.suppression?.reason).includes('complaint')).length,
      bounces: suppressed.filter((contact) => clean(contact.suppression?.reason).includes('bounce')).length,
      unsubscribes: suppressed.filter((contact) => clean(contact.suppression?.reason).includes('unsubscribe')).length,
      manual: suppressed.filter((contact) => clean(contact.suppression?.reason).includes('manual')).length,
      automaticUnsuppressionAllowed: 0
    },
    reasonRows: [...reasonRows.values()].map(finish).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, reviewLimit),
    sourceRows: [...sourceRows.values()].map(finish).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, reviewLimit),
    domainRows: [...domainRows.values()].map(finish).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, reviewLimit),
    samples: suppressed.slice(0, reviewLimit).map((contact) => ({
      id: contact.id || null,
      email: contact.email,
      source: contact.source || null,
      domain: contact.domain || null,
      suppressionReason: contact.suppression?.reason || null,
      suppressionSource: contact.suppression?.source || null,
      suppressedAt: contact.suppression?.createdAt || contact.suppression?.updatedAt || null,
      riskFlags: contact.riskFlags || [],
      recommendation: clean(contact.suppression?.reason).includes('unsubscribe') ? 'honor_unsubscribe_no_repermission_without_new_explicit_consent' : 'keep_suppressed_until_manual_operator_review',
      realDeliveryAllowed: false
    })),
    recommendations,
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
      automaticUnsuppressionAllowed: false,
      realDeliveryAllowed: false
    },
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};


export const contactRiskTriageQueue = ({ source = '', domain = '', risk = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const browser = browseContacts({ source, domain, risk: risk || 'risky', staleAfterDays, limit: 500 });
  const triageLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const riskFilter = clean(risk);
  const riskyContacts = (browser.contacts || []).filter((contact) => {
    const flags = contact.riskFlags || [];
    if (!riskFilter || riskFilter === 'risky') return flags.length > 0;
    return flags.includes(riskFilter);
  });
  const riskRows = new Map();
  const sourceRows = new Map();
  const domainRows = new Map();
  const addRow = (map, key, contact, flag = null) => {
    const row = map.get(key) || { key, total: 0, suppressed: 0, stale: 0, roleAccounts: 0, missingConsent: 0, missingSource: 0, bounced: 0, complained: 0, sources: new Set(), domains: new Set(), riskFlags: new Set() };
    row.total += 1;
    const flags = contact.riskFlags || [];
    if (contact.suppressed) row.suppressed += 1;
    if (flags.includes('stale_contact')) row.stale += 1;
    if (flags.includes('role_account')) row.roleAccounts += 1;
    if (flags.includes('missing_explicit_consent')) row.missingConsent += 1;
    if (flags.includes('missing_source')) row.missingSource += 1;
    row.bounced += contact.eventCounts?.bounce || 0;
    row.complained += contact.eventCounts?.complaint || 0;
    row.sources.add(contact.source || 'unknown_source');
    row.domains.add(contact.domain || domainOf(contact.email) || 'unknown_domain');
    for (const item of flags) row.riskFlags.add(item);
    if (flag) row.riskFlags.add(flag);
    map.set(key, row);
  };
  for (const contact of riskyContacts) {
    for (const flag of contact.riskFlags || ['unknown_risk']) addRow(riskRows, flag, contact, flag);
    addRow(sourceRows, contact.source || 'unknown_source', contact);
    addRow(domainRows, contact.domain || domainOf(contact.email) || 'unknown_domain', contact);
  }
  const actionFor = (row) => {
    if (row.complained > 0) return 'quarantine_and_review_complaint_source_before_audience_use';
    if (row.suppressed > 0 || row.bounced > 0) return 'exclude_suppressed_or_bounced_contacts_before_segment_snapshot';
    if (row.missingConsent > 0 || row.missingSource > 0) return 'repair_source_and_explicit_consent_metadata_before_campaign_use';
    if (row.stale > 0) return 'refresh_stale_consent_or_exclude_from_campaign_audiences';
    if (row.roleAccounts > 0) return 'operator_sample_role_accounts_before_affiliate_campaign_use';
    return 'operator_review_before_segment_snapshot';
  };
  const finish = (row) => ({
    ...row,
    sources: row.sources.size,
    domains: row.domains.size,
    riskFlags: [...row.riskFlags].sort(),
    priority: row.complained > 0 || row.suppressed > 0 ? 'high' : (row.bounced > 0 || row.missingConsent > 0 || row.missingSource > 0 ? 'medium' : 'low'),
    reviewGate: true,
    recommendedAction: actionFor(row),
    realDeliveryAllowed: false
  });
  const rank = { high: 0, medium: 1, low: 2 };
  const sortRows = (rows) => rows.map(finish).sort((a, b) => rank[a.priority] - rank[b.priority] || b.total - a.total || a.key.localeCompare(b.key)).slice(0, triageLimit);
  const samples = riskyContacts.slice(0, triageLimit).map((contact) => ({
    id: contact.id || null,
    email: contact.email,
    source: contact.source || null,
    domain: contact.domain || null,
    consentStatus: contact.consentStatus || null,
    suppressed: Boolean(contact.suppressed),
    riskFlags: contact.riskFlags || [],
    eventCounts: contact.eventCounts || {},
    recommendedAction: contact.suppressed ? 'exclude_suppressed_contact' : ((contact.riskFlags || []).includes('stale_contact') ? 'refresh_consent_or_exclude' : 'operator_review_before_segment_use'),
    realDeliveryAllowed: false
  }));
  const recommendations = [];
  if (riskyContacts.some((contact) => contact.suppressed)) recommendations.push('exclude_suppressed_contacts_from_all_segments_and_snapshots');
  if (riskyContacts.some((contact) => (contact.eventCounts?.complaint || 0) > 0)) recommendations.push('quarantine_sources_with_complaint_events_until_operator_review');
  if (riskyContacts.some((contact) => (contact.riskFlags || []).includes('missing_explicit_consent'))) recommendations.push('repair_or_exclude_contacts_without_explicit_consent_before_campaign_use');
  if (riskyContacts.some((contact) => (contact.riskFlags || []).includes('stale_contact'))) recommendations.push('refresh_stale_consent_before_warmup_or_campaign_scheduling');
  if (!recommendations.length) recommendations.push(riskyContacts.length ? 'sample_low_priority_risks_before_segment_snapshot' : 'no_risky_contacts_match_current_filters');

  return {
    ok: true,
    mode: 'contact-risk-triage-queue',
    filters: { ...browser.filters, risk: riskFilter || 'risky', limit: triageLimit },
    totals: {
      riskyContacts: riskyContacts.length,
      riskTypes: riskRows.size,
      sources: sourceRows.size,
      domains: domainRows.size,
      highPriorityRows: sortRows([...riskRows.values()]).filter((row) => row.priority === 'high').length,
      mediumPriorityRows: sortRows([...riskRows.values()]).filter((row) => row.priority === 'medium').length,
      lowPriorityRows: sortRows([...riskRows.values()]).filter((row) => row.priority === 'low').length,
      automaticAudienceMutationAllowed: 0
    },
    riskRows: sortRows([...riskRows.values()]),
    sourceRows: sortRows([...sourceRows.values()]),
    domainRows: sortRows([...domainRows.values()]),
    samples,
    recommendations,
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
      automaticAudienceMutationAllowed: false,
      realDeliveryAllowed: false
    },
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};


export const contactAudienceExclusionPreview = ({ source = '', domain = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const browser = browseContacts({ source, domain, staleAfterDays, limit: 500 });
  const previewLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const contacts = browser.contacts || [];
  const exclusionRows = new Map();
  const retained = [];
  const excluded = [];
  const addExclusion = (reason, contact) => {
    const row = exclusionRows.get(reason) || { reason, contacts: 0, suppressed: 0, stale: 0, roleAccounts: 0, missingConsent: 0, missingSource: 0, bounced: 0, complained: 0, sources: new Set(), domains: new Set() };
    row.contacts += 1;
    const flags = contact.riskFlags || [];
    if (contact.suppressed) row.suppressed += 1;
    if (flags.includes('stale_contact')) row.stale += 1;
    if (flags.includes('role_account')) row.roleAccounts += 1;
    if (flags.includes('missing_explicit_consent')) row.missingConsent += 1;
    if (flags.includes('missing_source')) row.missingSource += 1;
    row.bounced += contact.eventCounts?.bounce || 0;
    row.complained += contact.eventCounts?.complaint || 0;
    row.sources.add(contact.source || 'unknown_source');
    row.domains.add(contact.domain || domainOf(contact.email) || 'unknown_domain');
    exclusionRows.set(reason, row);
  };
  for (const contact of contacts) {
    const reasons = [];
    const flags = contact.riskFlags || [];
    if (contact.suppressed) reasons.push('suppressed_contact');
    if (!['opt_in', 'double_opt_in'].includes(contact.consentStatus)) reasons.push('missing_or_non_explicit_consent');
    if (!contact.source) reasons.push('missing_source_metadata');
    if (flags.includes('stale_contact')) reasons.push('stale_consent');
    if (flags.includes('role_account')) reasons.push('role_account_review');
    if ((contact.eventCounts?.bounce || 0) > 0) reasons.push('bounce_history_review');
    if ((contact.eventCounts?.complaint || 0) > 0) reasons.push('complaint_history_hard_stop');
    if (reasons.length) {
      excluded.push({ contact, reasons });
      for (const reason of reasons) addExclusion(reason, contact);
    } else {
      retained.push(contact);
    }
  }
  const rows = [...exclusionRows.values()].map((row) => ({
    ...row,
    sources: row.sources.size,
    domains: row.domains.size,
    reviewGate: true,
    recommendation: row.reason === 'complaint_history_hard_stop'
      ? 'exclude_and_review_complaint_source_before_any_campaign_use'
      : row.reason === 'suppressed_contact'
        ? 'exclude_from_all_segment_snapshots_and_campaigns'
        : row.reason === 'missing_or_non_explicit_consent'
          ? 'repair_explicit_consent_or_exclude_from_audience'
          : row.reason === 'stale_consent'
            ? 'refresh_consent_or_exclude_before_warmup_scheduling'
            : 'operator_review_before_campaign_audience_use',
    realDeliveryAllowed: false
  })).sort((a, b) => b.contacts - a.contacts || a.reason.localeCompare(b.reason)).slice(0, previewLimit);
  const recommendations = [];
  if (rows.some((row) => row.reason === 'suppressed_contact')) recommendations.push('apply_suppression_exclusion_to_all_saved_segments_and_snapshots');
  if (rows.some((row) => row.reason === 'complaint_history_hard_stop')) recommendations.push('quarantine_complaint_history_contacts_and_review_sources');
  if (rows.some((row) => row.reason === 'missing_or_non_explicit_consent')) recommendations.push('repair_or_exclude_contacts_without_explicit_consent');
  if (rows.some((row) => row.reason === 'stale_consent')) recommendations.push('refresh_or_exclude_stale_consent_before_campaign_scheduling');
  if (!recommendations.length) recommendations.push(contacts.length ? 'current_filters_have_no_exclusion_recommendations_for_dry_run_planning' : 'import_consented_contacts_before_exclusion_preview');

  return {
    ok: true,
    mode: 'contact-audience-exclusion-preview',
    filters: { ...browser.filters, limit: previewLimit },
    totals: {
      matchedContacts: contacts.length,
      retainedContacts: retained.length,
      excludedContacts: excluded.length,
      exclusionReasons: rows.length,
      suppressionExclusions: excluded.filter((item) => item.reasons.includes('suppressed_contact')).length,
      staleExclusions: excluded.filter((item) => item.reasons.includes('stale_consent')).length,
      roleAccountReviews: excluded.filter((item) => item.reasons.includes('role_account_review')).length,
      complaintHardStops: excluded.filter((item) => item.reasons.includes('complaint_history_hard_stop')).length,
      automaticSegmentMutationAllowed: 0
    },
    exclusionRows: rows,
    excludedSamples: excluded.slice(0, previewLimit).map(({ contact, reasons }) => ({
      id: contact.id || null,
      email: contact.email,
      source: contact.source || null,
      domain: contact.domain || null,
      consentStatus: contact.consentStatus || null,
      suppressed: Boolean(contact.suppressed),
      reasons,
      recommendation: reasons.includes('suppressed_contact') ? 'exclude_from_segment_snapshot' : 'operator_review_or_metadata_repair_before_segment_use',
      realDeliveryAllowed: false
    })),
    retainedSamples: retained.slice(0, previewLimit).map((contact) => ({
      id: contact.id || null,
      email: contact.email,
      source: contact.source || null,
      domain: contact.domain || null,
      consentStatus: contact.consentStatus || null,
      realDeliveryAllowed: false
    })),
    recommendations,
    safety: {
      adminOnly: true,
      readOnly: true,
      previewOnly: true,
      noContactMutation: true,
      noSuppressionMutation: true,
      noSegmentMutation: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noNetworkProbe: true,
      automaticSegmentMutationAllowed: false,
      realDeliveryAllowed: false
    },
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};
