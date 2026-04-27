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
