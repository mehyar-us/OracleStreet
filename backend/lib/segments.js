import { getAllContacts } from './contacts.js';
import { getSuppression, isSuppressed } from './suppressions.js';

const segments = new Map();
let sequence = 0;

const nowIso = () => new Date().toISOString();
const normalize = (value) => String(value || '').trim().toLowerCase();

export const resetSegmentsForTests = () => {
  segments.clear();
  sequence = 0;
};

const sanitizeCriteria = (criteria = {}) => ({
  consentStatus: normalize(criteria.consentStatus || criteria.consent_status) || null,
  sourceIncludes: normalize(criteria.sourceIncludes || criteria.source_includes) || null,
  emailDomain: normalize(criteria.emailDomain || criteria.email_domain).replace(/^@/, '') || null,
  includeSuppressed: criteria.includeSuppressed === true
});

const validateCriteria = (criteria) => {
  const errors = [];
  if (criteria.consentStatus && !['opt_in', 'double_opt_in'].includes(criteria.consentStatus)) {
    errors.push('valid_consent_status_required');
  }
  if (criteria.emailDomain && !criteria.emailDomain.includes('.')) errors.push('valid_email_domain_required');
  return errors;
};

const matchesSegment = (contact, criteria) => {
  if (criteria.consentStatus && contact.consentStatus !== criteria.consentStatus) return false;
  if (criteria.sourceIncludes && !normalize(contact.source).includes(criteria.sourceIncludes)) return false;
  if (criteria.emailDomain && !contact.email.endsWith(`@${criteria.emailDomain}`)) return false;
  if (!criteria.includeSuppressed && isSuppressed(contact.email)) return false;
  return true;
};

export const estimateSegmentAudience = (criteria = {}) => {
  const cleanCriteria = sanitizeCriteria(criteria);
  const errors = validateCriteria(cleanCriteria);
  if (errors.length > 0) return { ok: false, errors };

  const contacts = getAllContacts();
  const matching = contacts.filter((contact) => matchesSegment(contact, cleanCriteria));
  const suppressed = contacts
    .filter((contact) => isSuppressed(contact.email))
    .map((contact) => ({ email: contact.email, suppression: getSuppression(contact.email) }));

  return {
    ok: true,
    mode: 'safe-segment-estimate',
    criteria: cleanCriteria,
    totalContacts: contacts.length,
    estimatedAudience: matching.length,
    suppressedCount: suppressed.length,
    contacts: matching.map((contact) => ({ ...contact })),
    suppressed
  };
};

export const createSegment = ({ name, criteria = {}, actorEmail = null }) => {
  const cleanName = String(name || '').trim();
  const estimate = estimateSegmentAudience(criteria);
  const errors = [];
  if (!cleanName) errors.push('segment_name_required');
  if (!estimate.ok) errors.push(...estimate.errors);
  if (errors.length > 0) return { ok: false, errors };

  const segment = {
    id: `seg_${(++sequence).toString().padStart(6, '0')}`,
    name: cleanName,
    criteria: estimate.criteria,
    estimatedAudience: estimate.estimatedAudience,
    actorEmail,
    createdAt: nowIso(),
    updatedAt: null
  };
  segments.set(segment.id, segment);
  return { ok: true, mode: 'in-memory-segment', segment: { ...segment }, estimate };
};

export const listSegments = () => ({
  ok: true,
  count: segments.size,
  segments: [...segments.values()].map((segment) => ({ ...segment, criteria: { ...segment.criteria } }))
});

export const getSegment = (id) => {
  const segment = segments.get(String(id || '').trim());
  return segment ? { ...segment, criteria: { ...segment.criteria } } : null;
};
