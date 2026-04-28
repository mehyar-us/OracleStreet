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


export const contactSourceQuarantinePlan = ({ scoreThreshold = 70, staleAfterDays = 180, limit = 100 } = {}) => {
  const overview = browseContacts({ staleAfterDays, limit: 500 });
  const threshold = Math.max(0, Math.min(100, Number(scoreThreshold) || 70));
  const rowLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const sources = overview.sourceQuality || [];
  const rows = sources.map((source) => {
    const reasons = [];
    if (source.complained > 0) reasons.push('complaint_events');
    if (source.bounced > 0) reasons.push('bounce_events');
    if (source.suppressed > 0) reasons.push('suppressed_contacts');
    if (source.stale > 0) reasons.push('stale_consent');
    if (source.score < threshold) reasons.push('low_source_quality_score');
    if (source.risky > 0) reasons.push('risky_contact_flags');
    const priority = source.complained > 0 || source.score < 50 ? 'high' : (source.bounced > 0 || source.suppressed > 0 || source.score < threshold ? 'medium' : 'low');
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
      reasons,
      quarantineRecommended: priority !== 'low' || reasons.includes('complaint_events'),
      suggestedAudienceRule: priority !== 'low' ? 'exclude_source_from_campaign_segments_until_operator_review' : 'allow_dry_run_planning_with_monitoring_only',
      operatorChecklist: [
        'verify_source_consent_collection_method',
        'review_suppression_and_event_samples',
        'refresh_or_exclude_stale_contacts',
        'document_operator_decision_before_campaign_use'
      ],
      realDeliveryAllowed: false
    };
  }).sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.priority] - rank[b.priority] || a.score - b.score || b.total - a.total;
  }).slice(0, rowLimit);
  const recommendations = [];
  if (rows.some((row) => row.priority === 'high')) recommendations.push('quarantine_high_priority_sources_before_segment_snapshot_or_campaign_use');
  if (rows.some((row) => row.reasons.includes('complaint_events'))) recommendations.push('complaint_sources_require_operator_review_and_source_quality_notes');
  if (rows.some((row) => row.reasons.includes('stale_consent'))) recommendations.push('refresh_stale_consent_or_exclude_affected_sources');
  if (!recommendations.length) recommendations.push(rows.length ? 'sources_clear_for_dry_run_planning_only' : 'import_contacts_with_source_metadata_before_quarantine_planning');
  return {
    ok: true,
    mode: 'contact-source-quarantine-plan',
    scoreThreshold: threshold,
    totals: {
      sourcesReviewed: sources.length,
      highPrioritySources: rows.filter((row) => row.priority === 'high').length,
      mediumPrioritySources: rows.filter((row) => row.priority === 'medium').length,
      quarantineRecommended: rows.filter((row) => row.quarantineRecommended).length,
      automaticSourceMutationAllowed: 0
    },
    rows,
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
      automaticSourceMutationAllowed: false,
      realDeliveryAllowed: false
    },
    persistenceMode: overview.persistenceMode,
    realDeliveryAllowed: false
  };
};


export const contactRepermissionPlan = ({ source = '', domain = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const browser = browseContacts({ source, domain, staleAfterDays, limit: 500 });
  const rowLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const candidates = (browser.contacts || []).map((contact) => {
    const flags = contact.riskFlags || [];
    const reasons = [];
    if (!['opt_in', 'double_opt_in'].includes(contact.consentStatus)) reasons.push('missing_or_non_explicit_consent');
    if (flags.includes('stale_contact')) reasons.push('stale_consent');
    if (!contact.source) reasons.push('missing_source_metadata');
    if (contact.suppressed) reasons.push('suppressed_contact_do_not_contact');
    if ((contact.eventCounts?.complaint || 0) > 0) reasons.push('complaint_history_do_not_contact');
    if ((contact.eventCounts?.bounce || 0) > 0) reasons.push('bounce_history_do_not_contact');
    return { contact, reasons };
  }).filter((item) => item.reasons.length);
  const rowsByReason = new Map();
  const rowsBySource = new Map();
  const add = (map, key, item) => {
    const row = map.get(key) || { key, contacts: 0, doNotContact: 0, repermissionCandidates: 0, stale: 0, missingConsent: 0, missingSource: 0, sources: new Set(), domains: new Set() };
    row.contacts += 1;
    const { contact, reasons } = item;
    const hardStop = reasons.some((reason) => reason.includes('do_not_contact'));
    if (hardStop) row.doNotContact += 1;
    else row.repermissionCandidates += 1;
    if (reasons.includes('stale_consent')) row.stale += 1;
    if (reasons.includes('missing_or_non_explicit_consent')) row.missingConsent += 1;
    if (reasons.includes('missing_source_metadata')) row.missingSource += 1;
    row.sources.add(contact.source || 'unknown_source');
    row.domains.add(contact.domain || domainOf(contact.email) || 'unknown_domain');
    map.set(key, row);
  };
  for (const item of candidates) {
    for (const reason of item.reasons) add(rowsByReason, reason, item);
    add(rowsBySource, item.contact.source || 'unknown_source', item);
  }
  const finish = (row) => ({
    ...row,
    sources: row.sources.size,
    domains: row.domains.size,
    reviewGate: true,
    recommendation: row.doNotContact > 0
      ? 'exclude_do_not_contact_records_and_review_source_history'
      : row.missingConsent > 0
        ? 'repair_explicit_consent_or_collect_permission_before_campaign_use'
        : row.stale > 0
          ? 'refresh_permission_before_campaign_or_warmup_use'
          : 'operator_review_before_repermission_or_segment_use',
    outboundRepermissionAllowed: false,
    realDeliveryAllowed: false
  });
  const reasonRows = [...rowsByReason.values()].map(finish).sort((a, b) => b.contacts - a.contacts || a.key.localeCompare(b.key)).slice(0, rowLimit);
  const sourceRows = [...rowsBySource.values()].map(finish).sort((a, b) => b.contacts - a.contacts || a.key.localeCompare(b.key)).slice(0, rowLimit);
  const samples = candidates.slice(0, rowLimit).map(({ contact, reasons }) => ({
    id: contact.id || null,
    email: contact.email,
    source: contact.source || null,
    domain: contact.domain || null,
    consentStatus: contact.consentStatus || null,
    suppressed: Boolean(contact.suppressed),
    reasons,
    recommendedAction: reasons.some((reason) => reason.includes('do_not_contact')) ? 'do_not_contact_exclude_from_segments' : 'repair_permission_metadata_or_refresh_consent_manually',
    outboundRepermissionAllowed: false,
    realDeliveryAllowed: false
  }));
  const recommendations = [];
  if (candidates.some(({ reasons }) => reasons.includes('suppressed_contact_do_not_contact'))) recommendations.push('never_repermission_suppressed_contacts_without_separate_human_legal_review');
  if (candidates.some(({ reasons }) => reasons.includes('complaint_history_do_not_contact'))) recommendations.push('exclude_complaint_history_contacts_from_repermission_and_campaign_use');
  if (candidates.some(({ reasons }) => reasons.includes('missing_or_non_explicit_consent'))) recommendations.push('repair_explicit_consent_metadata_before_any_campaign_or_repermission_work');
  if (candidates.some(({ reasons }) => reasons.includes('stale_consent'))) recommendations.push('refresh_stale_consent_through_manual_operator_process_before_campaign_use');
  if (!recommendations.length) recommendations.push('no_repermission_candidates_match_current_filters');
  return {
    ok: true,
    mode: 'contact-repermission-plan',
    filters: { ...browser.filters, limit: rowLimit },
    totals: {
      matchedContacts: (browser.contacts || []).length,
      repermissionReviewContacts: candidates.length,
      doNotContact: candidates.filter((item) => item.reasons.some((reason) => reason.includes('do_not_contact'))).length,
      staleConsent: candidates.filter((item) => item.reasons.includes('stale_consent')).length,
      missingConsent: candidates.filter((item) => item.reasons.includes('missing_or_non_explicit_consent')).length,
      outboundRepermissionAllowed: 0,
      automaticContactMutationAllowed: 0
    },
    reasonRows,
    sourceRows,
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
      outboundRepermissionAllowed: false,
      automaticContactMutationAllowed: false,
      realDeliveryAllowed: false
    },
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};


export const contactDomainRiskPlan = ({ source = '', domain = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const browser = browseContacts({ source, domain, staleAfterDays, limit: 500 });
  const rowLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const rowsByDomain = new Map();
  for (const contact of browser.contacts || []) {
    const key = contact.domain || domainOf(contact.email) || 'unknown_domain';
    const row = rowsByDomain.get(key) || { domain: key, contacts: 0, ready: 0, blocked: 0, suppressed: 0, risky: 0, stale: 0, roleAccounts: 0, missingConsent: 0, bounced: 0, complained: 0, sources: new Set(), riskFlags: new Set() };
    row.contacts += 1;
    const flags = contact.riskFlags || [];
    const hardBlocked = Boolean(contact.suppressed) || !['opt_in', 'double_opt_in'].includes(contact.consentStatus) || (contact.eventCounts?.complaint || 0) > 0 || (contact.eventCounts?.bounce || 0) > 0;
    if (hardBlocked) row.blocked += 1;
    else row.ready += 1;
    if (contact.suppressed) row.suppressed += 1;
    if (flags.length) row.risky += 1;
    if (flags.includes('stale_contact')) row.stale += 1;
    if (flags.includes('role_account')) row.roleAccounts += 1;
    if (flags.includes('missing_explicit_consent')) row.missingConsent += 1;
    row.bounced += contact.eventCounts?.bounce || 0;
    row.complained += contact.eventCounts?.complaint || 0;
    row.sources.add(contact.source || 'unknown_source');
    for (const flag of flags) row.riskFlags.add(flag);
    rowsByDomain.set(key, row);
  }
  const rows = [...rowsByDomain.values()].map((row) => {
    const bounceComplaintLoad = row.bounced + row.complained;
    const blockedRate = row.contacts ? row.blocked / row.contacts : 0;
    const priority = row.complained > 0 || blockedRate >= 0.5 ? 'high' : (row.bounced > 0 || row.suppressed > 0 || row.risky > 0 || blockedRate >= 0.25 ? 'medium' : 'low');
    const recommendedAction = priority === 'high'
      ? 'pause_domain_from_campaign_audiences_until_operator_review'
      : priority === 'medium'
        ? 'limit_domain_allocation_and_review_samples_before_scheduling'
        : 'allow_dry_run_planning_with_warmup_cap_monitoring';
    return {
      ...row,
      sources: row.sources.size,
      riskFlags: [...row.riskFlags].sort(),
      blockedRate,
      bounceComplaintLoad,
      priority,
      reviewGate: priority !== 'low',
      mxProbePerformed: false,
      recommendedAction,
      realDeliveryAllowed: false
    };
  }).sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.priority] - rank[b.priority] || b.blocked - a.blocked || b.contacts - a.contacts || a.domain.localeCompare(b.domain);
  }).slice(0, rowLimit);
  const recommendations = [];
  if (rows.some((row) => row.priority === 'high')) recommendations.push('pause_high_risk_domains_from_campaign_calendar_until_operator_review');
  if (rows.some((row) => row.complained > 0)) recommendations.push('treat_complaint_domains_as_hard_stop_for_delivery_until_source_review');
  if (rows.some((row) => row.stale > 0)) recommendations.push('refresh_stale_domain_contacts_before_warmup_allocation');
  if (!recommendations.length) recommendations.push(rows.length ? 'domain_rows_clear_for_dry_run_planning_only' : 'import_contacts_before_domain_risk_planning');
  return {
    ok: true,
    mode: 'contact-domain-risk-plan',
    filters: { ...browser.filters, limit: rowLimit },
    totals: {
      domainsReviewed: rowsByDomain.size,
      highPriorityDomains: rows.filter((row) => row.priority === 'high').length,
      mediumPriorityDomains: rows.filter((row) => row.priority === 'medium').length,
      blockedContacts: rows.reduce((sum, row) => sum + row.blocked, 0),
      readyContacts: rows.reduce((sum, row) => sum + row.ready, 0),
      mxProbePerformed: 0,
      automaticDomainMutationAllowed: 0
    },
    rows,
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
      mxProbePerformed: false,
      automaticDomainMutationAllowed: false,
      realDeliveryAllowed: false
    },
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};


export const contactEngagementRecencyPlan = ({ source = '', domain = '', staleAfterDays = 180, engagementWindowDays = 90, limit = 100 } = {}) => {
  const browser = browseContacts({ source, domain, staleAfterDays, limit: 500 });
  const rowLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const windowDays = Math.max(1, Math.min(730, Number(engagementWindowDays) || 90));
  const cutoff = nowMs() - windowDays * 24 * 60 * 60 * 1000;
  const rowsByStatus = new Map();
  const rowsBySource = new Map();
  const add = (map, key, contact, status, lastEngagementAt) => {
    const row = map.get(key) || { key, contacts: 0, recentlyEngaged: 0, dormant: 0, noPositiveEngagement: 0, blocked: 0, suppressed: 0, bounced: 0, complained: 0, sources: new Set(), domains: new Set() };
    row.contacts += 1;
    if (status === 'recently_engaged') row.recentlyEngaged += 1;
    if (status === 'dormant') row.dormant += 1;
    if (status === 'no_positive_engagement') row.noPositiveEngagement += 1;
    if (contact.suppressed || (contact.eventCounts?.bounce || 0) > 0 || (contact.eventCounts?.complaint || 0) > 0) row.blocked += 1;
    if (contact.suppressed) row.suppressed += 1;
    row.bounced += contact.eventCounts?.bounce || 0;
    row.complained += contact.eventCounts?.complaint || 0;
    row.sources.add(contact.source || 'unknown_source');
    row.domains.add(contact.domain || domainOf(contact.email) || 'unknown_domain');
    if (lastEngagementAt && (!row.latestEngagementAt || Date.parse(lastEngagementAt) > Date.parse(row.latestEngagementAt))) row.latestEngagementAt = lastEngagementAt;
    map.set(key, row);
  };
  const samples = [];
  for (const contact of browser.contacts || []) {
    const positiveEvents = (contact.timeline || []).filter((entry) => ['event:open', 'event:click'].includes(entry.type));
    const lastPositive = positiveEvents.map((entry) => entry.at).filter(Boolean).sort().at(-1) || null;
    const lastPositiveMs = Date.parse(lastPositive || '');
    const status = Number.isFinite(lastPositiveMs) && lastPositiveMs >= cutoff
      ? 'recently_engaged'
      : lastPositive
        ? 'dormant'
        : 'no_positive_engagement';
    add(rowsByStatus, status, contact, status, lastPositive);
    add(rowsBySource, contact.source || 'unknown_source', contact, status, lastPositive);
    samples.push({
      email: contact.email,
      source: contact.source || null,
      domain: contact.domain || null,
      engagementStatus: status,
      lastPositiveEngagementAt: lastPositive,
      suppressed: Boolean(contact.suppressed),
      blockedByBounceOrComplaint: Boolean((contact.eventCounts?.bounce || 0) || (contact.eventCounts?.complaint || 0)),
      recommendedAction: contact.suppressed || (contact.eventCounts?.complaint || 0) || (contact.eventCounts?.bounce || 0)
        ? 'exclude_from_engagement_ramp_and_campaign_use'
        : status === 'recently_engaged'
          ? 'eligible_for_dry_run_segment_planning_with_warmup_caps'
          : status === 'dormant'
            ? 'review_before_low_volume_reactivation_planning'
            : 'do_not_prioritize_until_positive_engagement_or_permission_refresh',
      realDeliveryAllowed: false
    });
  }
  const finish = (row) => ({
    ...row,
    sources: row.sources.size,
    domains: row.domains.size,
    reviewGate: row.blocked > 0 || row.dormant > 0 || row.noPositiveEngagement > 0,
    recommendation: row.blocked > 0
      ? 'exclude_blocked_contacts_before_engagement_or_campaign_planning'
      : row.noPositiveEngagement > 0
        ? 'prioritize_permission_refresh_or_owned_engagement_before_campaign_use'
        : row.dormant > 0
          ? 'limit_reactivation_to_operator_reviewed_low_volume_plan'
          : 'eligible_for_dry_run_campaign_planning_with_caps',
    queueMutationAllowed: false,
    realDeliveryAllowed: false
  });
  const statusRows = [...rowsByStatus.values()].map(finish).sort((a, b) => b.blocked - a.blocked || b.contacts - a.contacts || a.key.localeCompare(b.key)).slice(0, rowLimit);
  const sourceRows = [...rowsBySource.values()].map(finish).sort((a, b) => b.blocked - a.blocked || b.contacts - a.contacts || a.key.localeCompare(b.key)).slice(0, rowLimit);
  const recommendations = [];
  if (statusRows.some((row) => row.blocked > 0)) recommendations.push('exclude_bounced_complained_or_suppressed_contacts_from_engagement_ramps');
  if (statusRows.some((row) => row.noPositiveEngagement > 0)) recommendations.push('treat_no_positive_engagement_as_operator_review_before_campaign_or_reactivation_use');
  if (statusRows.some((row) => row.dormant > 0)) recommendations.push('cap_dormant_contact_reactivation_to_future_human_approved_low_volume_tests');
  if (!recommendations.length) recommendations.push(statusRows.length ? 'engagement_rows_clear_for_dry_run_planning_only' : 'import_contacts_before_engagement_recency_planning');
  return {
    ok: true,
    mode: 'contact-engagement-recency-plan',
    filters: { ...browser.filters, engagementWindowDays: windowDays, limit: rowLimit },
    totals: {
      matchedContacts: (browser.contacts || []).length,
      recentlyEngagedContacts: samples.filter((row) => row.engagementStatus === 'recently_engaged').length,
      dormantContacts: samples.filter((row) => row.engagementStatus === 'dormant').length,
      noPositiveEngagementContacts: samples.filter((row) => row.engagementStatus === 'no_positive_engagement').length,
      blockedContacts: samples.filter((row) => row.suppressed || row.blockedByBounceOrComplaint).length,
      automaticQueueMutationAllowed: 0,
      realDeliveryAllowed: false
    },
    statusRows,
    sourceRows,
    samples: samples.slice(0, rowLimit),
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
      automaticQueueMutationAllowed: false,
      realDeliveryAllowed: false
    },
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};


export const contactConsentProvenanceReview = ({ source = '', domain = '', consentStatus = '', staleAfterDays = 180, limit = 100 } = {}) => {
  const browser = browseContacts({ source, domain, consentStatus, staleAfterDays, limit: 500 });
  const rowLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const consentRows = new Map();
  const sourceRows = new Map();
  const issueRows = new Map();
  const add = (map, key, contact, issues) => {
    const row = map.get(key) || { key, contacts: 0, explicitConsent: 0, missingConsent: 0, missingSource: 0, stale: 0, suppressed: 0, risky: 0, issues: new Set(), domains: new Set(), sources: new Set() };
    row.contacts += 1;
    if (['opt_in', 'double_opt_in'].includes(contact.consentStatus)) row.explicitConsent += 1;
    else row.missingConsent += 1;
    if (!contact.source) row.missingSource += 1;
    if ((contact.riskFlags || []).includes('stale_contact')) row.stale += 1;
    if (contact.suppressed) row.suppressed += 1;
    if ((contact.riskFlags || []).length) row.risky += 1;
    for (const issue of issues) row.issues.add(issue);
    row.domains.add(contact.domain || domainOf(contact.email) || 'unknown_domain');
    row.sources.add(contact.source || 'unknown_source');
    map.set(key, row);
  };
  const samples = [];
  for (const contact of browser.contacts || []) {
    const issues = [];
    if (!['opt_in', 'double_opt_in'].includes(contact.consentStatus)) issues.push('missing_explicit_consent');
    if (!contact.source) issues.push('missing_source_metadata');
    if ((contact.riskFlags || []).includes('stale_contact')) issues.push('stale_consent_or_source_record');
    if (contact.suppressed) issues.push('suppressed_do_not_contact');
    if ((contact.eventCounts?.complaint || 0) > 0) issues.push('complaint_history_do_not_contact');
    if ((contact.eventCounts?.bounce || 0) > 0) issues.push('bounce_history_review_required');
    if (!issues.length) issues.push('provenance_ready_for_dry_run_planning');
    add(consentRows, contact.consentStatus || 'missing_consent_status', contact, issues);
    add(sourceRows, contact.source || 'unknown_source', contact, issues);
    for (const issue of issues) add(issueRows, issue, contact, issues);
    samples.push({
      email: contact.email,
      source: contact.source || null,
      consentStatus: contact.consentStatus || null,
      domain: contact.domain || null,
      issues,
      provenanceReady: issues.length === 1 && issues[0] === 'provenance_ready_for_dry_run_planning',
      recommendedAction: issues.includes('suppressed_do_not_contact') || issues.includes('complaint_history_do_not_contact')
        ? 'exclude_from_campaign_and_repermission_until_separate_human_legal_review'
        : issues.includes('missing_explicit_consent')
          ? 'repair_or_collect_explicit_permission_before_campaign_or_warmup_use'
          : issues.includes('missing_source_metadata')
            ? 'repair_source_metadata_before_segment_use'
            : issues.includes('stale_consent_or_source_record')
              ? 'refresh_permission_metadata_before_campaign_use'
              : 'eligible_for_dry_run_audience_planning_with_suppression_checks',
      realDeliveryAllowed: false
    });
  }
  const finish = (row) => ({
    ...row,
    issues: [...row.issues].sort(),
    domains: row.domains.size,
    sources: row.sources.size,
    reviewGate: row.missingConsent > 0 || row.missingSource > 0 || row.stale > 0 || row.suppressed > 0,
    recommendation: row.suppressed > 0
      ? 'exclude_suppressed_contacts_and_preserve_do_not_contact_state'
      : row.missingConsent > 0
        ? 'repair_explicit_consent_metadata_before_campaign_use'
        : row.missingSource > 0
          ? 'repair_source_provenance_before_segment_use'
          : row.stale > 0
            ? 'refresh_stale_permission_records_before_campaign_use'
            : 'provenance_clear_for_dry_run_planning_only',
    automaticContactMutationAllowed: false,
    realDeliveryAllowed: false
  });
  const consentStatusRows = [...consentRows.values()].map(finish).sort((a, b) => b.missingConsent - a.missingConsent || b.contacts - a.contacts || a.key.localeCompare(b.key)).slice(0, rowLimit);
  const sourceProvenanceRows = [...sourceRows.values()].map(finish).sort((a, b) => b.missingConsent + b.missingSource + b.suppressed - (a.missingConsent + a.missingSource + a.suppressed) || b.contacts - a.contacts || a.key.localeCompare(b.key)).slice(0, rowLimit);
  const issueSummaryRows = [...issueRows.values()].map(finish).sort((a, b) => b.contacts - a.contacts || a.key.localeCompare(b.key)).slice(0, rowLimit);
  const recommendations = [];
  if (issueRows.has('suppressed_do_not_contact')) recommendations.push('preserve_suppression_and_exclude_do_not_contact_records_from_campaign_audiences');
  if (issueRows.has('missing_explicit_consent')) recommendations.push('repair_explicit_permission_before_campaign_or_repermission_use');
  if (issueRows.has('missing_source_metadata')) recommendations.push('repair_source_provenance_before_segment_or_import_scheduler_use');
  if (issueRows.has('stale_consent_or_source_record')) recommendations.push('refresh_stale_permission_metadata_before_warmup_or_campaign_use');
  if (!recommendations.length) recommendations.push(samples.length ? 'consent_provenance_clear_for_dry_run_planning_only' : 'import_contacts_before_consent_provenance_review');
  return {
    ok: true,
    mode: 'contact-consent-provenance-review',
    filters: { ...browser.filters, limit: rowLimit },
    totals: {
      matchedContacts: (browser.contacts || []).length,
      explicitConsentContacts: samples.filter((row) => ['opt_in', 'double_opt_in'].includes(row.consentStatus)).length,
      reviewRequiredContacts: samples.filter((row) => !row.provenanceReady).length,
      suppressedContacts: samples.filter((row) => row.issues.includes('suppressed_do_not_contact')).length,
      automaticContactMutationAllowed: 0,
      realDeliveryAllowed: false
    },
    consentStatusRows,
    sourceProvenanceRows,
    issueSummaryRows,
    samples: samples.slice(0, rowLimit),
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
      automaticContactMutationAllowed: false,
      realDeliveryAllowed: false
    },
    persistenceMode: browser.persistenceMode,
    realDeliveryAllowed: false
  };
};
