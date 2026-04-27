import { getAllContacts } from './contacts.js';
import { listSuppressions } from './suppressions.js';

const ROLE_LOCAL_PARTS = new Set(['admin', 'abuse', 'billing', 'compliance', 'contact', 'help', 'info', 'marketing', 'noreply', 'no-reply', 'postmaster', 'sales', 'security', 'support', 'webmaster']);
const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'proton.me', 'protonmail.com']);

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const emailDomain = (email) => normalizeEmail(email).split('@')[1] || '';
const localPart = (email) => normalizeEmail(email).split('@')[0] || '';
const daysBetween = (left, right) => Math.floor((left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000));

const sourceKey = (contact) => String(contact.source || 'unknown').trim() || 'unknown';

export const buildListHygienePlan = ({ staleAfterDays = 180 } = {}) => {
  const contacts = getAllContacts();
  const suppressions = listSuppressions().suppressions || [];
  const suppressedEmails = new Set(suppressions.map((entry) => normalizeEmail(entry.email)));
  const now = new Date();
  const byEmail = new Map();
  const bySource = new Map();

  contacts.forEach((contact) => {
    const email = normalizeEmail(contact.email);
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(contact);

    const key = sourceKey(contact);
    if (!bySource.has(key)) {
      bySource.set(key, { source: key, total: 0, suppressed: 0, risky: 0, missingConsent: 0, stale: 0, score: 100 });
    }
    const source = bySource.get(key);
    source.total += 1;
  });

  const duplicateGroups = [...byEmail.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([email, rows]) => ({ email, count: rows.length, contactIds: rows.map((row) => row.id) }));

  const riskyContacts = [];
  const staleContacts = [];
  const suppressedContacts = [];
  const missingConsentContacts = [];
  const domainCounts = new Map();

  contacts.forEach((contact) => {
    const email = normalizeEmail(contact.email);
    const domain = emailDomain(email);
    const source = bySource.get(sourceKey(contact));
    const reasons = [];
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);

    if (suppressedEmails.has(email) || contact.status === 'suppressed') {
      suppressedContacts.push({ id: contact.id, email, reason: 'suppressed_or_unsubscribed' });
      source.suppressed += 1;
    }
    if (!['opt_in', 'double_opt_in'].includes(contact.consentStatus)) {
      missingConsentContacts.push({ id: contact.id, email, consentStatus: contact.consentStatus || null });
      source.missingConsent += 1;
    }
    if (ROLE_LOCAL_PARTS.has(localPart(email))) reasons.push('role_account');
    if (FREE_MAIL_DOMAINS.has(domain)) reasons.push('free_mail_domain');
    if (!contact.sourceDetail) reasons.push('missing_source_detail');
    const updatedAt = new Date(contact.updatedAt || contact.createdAt || now.toISOString());
    if (Number.isFinite(updatedAt.getTime()) && daysBetween(now, updatedAt) > Number(staleAfterDays)) {
      staleContacts.push({ id: contact.id, email, ageDays: daysBetween(now, updatedAt), lastTouchedAt: updatedAt.toISOString() });
      source.stale += 1;
    }
    if (reasons.length > 0) {
      riskyContacts.push({ id: contact.id, email, reasons });
      source.risky += 1;
    }
  });

  const domainConcentration = [...domainCounts.entries()]
    .filter(([domain]) => domain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count, share: contacts.length > 0 ? count / contacts.length : 0 }));

  const sourceQuality = [...bySource.values()].map((source) => {
    const riskPenalty = source.total > 0 ? Math.round(((source.suppressed + source.risky + source.missingConsent + source.stale) / source.total) * 100) : 0;
    return { ...source, score: Math.max(0, 100 - riskPenalty) };
  }).sort((a, b) => a.score - b.score || b.total - a.total);

  const recommendations = [];
  if (duplicateGroups.length > 0) recommendations.push({ priority: 'high', action: 'review_duplicate_contacts', count: duplicateGroups.length, note: 'Merge or quarantine duplicates before campaign approval.' });
  if (suppressedContacts.length > 0) recommendations.push({ priority: 'high', action: 'exclude_suppressed_contacts', count: suppressedContacts.length, note: 'Suppressed contacts are blocked by queue gates and should remain excluded.' });
  if (missingConsentContacts.length > 0) recommendations.push({ priority: 'high', action: 'repair_missing_consent', count: missingConsentContacts.length, note: 'Do not send until explicit consent/source provenance is repaired.' });
  if (riskyContacts.length > 0) recommendations.push({ priority: 'medium', action: 'review_risky_contacts', count: riskyContacts.length, note: 'Role accounts, free-mail concentration, and thin provenance need operator review.' });
  if (staleContacts.length > 0) recommendations.push({ priority: 'medium', action: 'refresh_stale_contacts', count: staleContacts.length, note: `Contacts older than ${staleAfterDays} days should be revalidated before warm-up sends.` });
  if (recommendations.length === 0) recommendations.push({ priority: 'low', action: 'keep_monitoring', count: contacts.length, note: 'No cleanup blockers found in the current in-memory sample.' });

  return {
    ok: true,
    mode: 'list-hygiene-cleanup-planner',
    staleAfterDays: Number(staleAfterDays),
    totals: {
      contacts: contacts.length,
      duplicateGroups: duplicateGroups.length,
      duplicateContacts: duplicateGroups.reduce((sum, group) => sum + group.count, 0),
      suppressedContacts: suppressedContacts.length,
      missingConsentContacts: missingConsentContacts.length,
      riskyContacts: riskyContacts.length,
      staleContacts: staleContacts.length,
      sources: sourceQuality.length
    },
    duplicateGroups,
    suppressedContacts,
    missingConsentContacts,
    riskyContacts,
    staleContacts,
    sourceQuality,
    domainConcentration,
    recommendations,
    cleanupMutation: false,
    realDeliveryAllowed: false
  };
};
