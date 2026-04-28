import { getAllContacts } from './contacts.js';
import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';
import { getSuppression, isSuppressed } from './suppressions.js';

const segments = new Map();
const snapshots = new Map();
let sequence = 0;
let snapshotSequence = 0;

const nowIso = () => new Date().toISOString();
const normalize = (value) => String(value || '').trim().toLowerCase();

export const resetSegmentsForTests = () => {
  segments.clear();
  snapshots.clear();
  sequence = 0;
  snapshotSequence = 0;
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

const parseJson = (value, fallback) => {
  try { return JSON.parse(value || ''); } catch { return fallback; }
};

const segmentFromPgRow = ([id, name, filterJson, estimatedAudience, actorEmail, snapshotCount, lastSnapshotAt, createdAt, updatedAt]) => ({
  id,
  name,
  criteria: parseJson(filterJson, {}),
  estimatedAudience: Number(estimatedAudience || 0),
  actorEmail: actorEmail || null,
  snapshotCount: Number(snapshotCount || 0),
  lastSnapshotAt: lastSnapshotAt || null,
  createdAt,
  updatedAt: updatedAt || null
});

const snapshotFromPgRow = ([id, segmentId, segmentName, filterJson, audienceCount, sampleContacts, createdBy, createdAt]) => ({
  id,
  segmentId,
  segmentName,
  criteria: parseJson(filterJson, {}),
  audienceCount: Number(audienceCount || 0),
  sampleContacts: parseJson(sampleContacts, []),
  createdBy: createdBy || null,
  createdAt,
  safety: { noDelivery: true, noContactMutation: true, reproducibleAudience: true, realDeliveryAllowed: false }
});

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

  if (isPgRepositoryEnabled('segments')) {
    try {
      const rows = runLocalPgRows(`
        INSERT INTO segments (name, filter_json, estimated_audience, actor_email, updated_at)
        VALUES (${sqlLiteral(cleanName)}, ${sqlLiteral(JSON.stringify(estimate.criteria))}::jsonb, ${Number(estimate.estimatedAudience || 0)}, ${sqlLiteral(actorEmail)}, now())
        ON CONFLICT (name) DO UPDATE SET
          filter_json = EXCLUDED.filter_json,
          estimated_audience = EXCLUDED.estimated_audience,
          actor_email = EXCLUDED.actor_email,
          updated_at = now()
        RETURNING id::text, name, filter_json::text, estimated_audience::text, actor_email, snapshot_count::text, last_snapshot_at::text, created_at::text, updated_at::text;
      `);
      return { ok: true, mode: 'postgresql-local-psql-segment', segment: segmentFromPgRow(rows[0]), estimate, persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
    } catch (error) {
      // Safe fallback keeps tests/dev usable if local psql is unavailable.
    }
  }

  const segment = {
    id: `seg_${(++sequence).toString().padStart(6, '0')}`,
    name: cleanName,
    criteria: estimate.criteria,
    estimatedAudience: estimate.estimatedAudience,
    actorEmail,
    snapshotCount: 0,
    lastSnapshotAt: null,
    createdAt: nowIso(),
    updatedAt: null
  };
  segments.set(segment.id, segment);
  return { ok: true, mode: 'in-memory-segment', segment: { ...segment }, estimate };
};

export const listSegments = () => {
  if (isPgRepositoryEnabled('segments')) {
    try {
      const rows = runLocalPgRows(`
        SELECT id::text, name, filter_json::text, estimated_audience::text, actor_email, snapshot_count::text, last_snapshot_at::text, created_at::text, updated_at::text
        FROM segments
        ORDER BY created_at DESC
        LIMIT 100;
      `);
      return { ok: true, mode: 'postgresql-local-psql-segments', count: rows.length, segments: rows.map(segmentFromPgRow), persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
    } catch (error) {
      // fall through to safe memory list
    }
  }
  return {
    ok: true,
    mode: 'in-memory-segments',
    count: segments.size,
    segments: [...segments.values()].map((segment) => ({ ...segment, criteria: { ...segment.criteria } })),
    persistenceMode: 'in-memory-until-postgresql-segments-enabled',
    realDeliveryAllowed: false
  };
};

export const getSegment = (id) => {
  if (isPgRepositoryEnabled('segments')) {
    try {
      const rows = runLocalPgRows(`
        SELECT id::text, name, filter_json::text, estimated_audience::text, actor_email, snapshot_count::text, last_snapshot_at::text, created_at::text, updated_at::text
        FROM segments
        WHERE id::text = ${sqlLiteral(String(id || '').trim())}
        LIMIT 1;
      `);
      if (rows[0]) return segmentFromPgRow(rows[0]);
    } catch (error) {
      // fall through to memory lookup
    }
  }
  const segment = segments.get(String(id || '').trim());
  return segment ? { ...segment, criteria: { ...segment.criteria } } : null;
};

export const createSegmentSnapshot = ({ segmentId, actorEmail = null } = {}) => {
  const segment = getSegment(segmentId);
  if (!segment) return { ok: false, mode: 'segment-snapshot', errors: ['segment_not_found'], realDeliveryAllowed: false };
  const estimate = estimateSegmentAudience(segment.criteria || {});
  if (!estimate.ok) return { ok: false, mode: 'segment-snapshot', errors: estimate.errors || ['segment_estimate_failed'], realDeliveryAllowed: false };
  const sampleContacts = estimate.contacts.slice(0, 25).map((contact) => ({
    email: contact.email,
    id: contact.id || null,
    source: contact.source || null,
    consentStatus: contact.consentStatus || null,
    status: contact.status || null
  }));
  const contactEmails = estimate.contacts.map((contact) => contact.email).sort();

  if (isPgRepositoryEnabled('segments')) {
    try {
      const rows = runLocalPgRows(`
        INSERT INTO segment_snapshots (segment_id, segment_name, filter_json, audience_count, contact_emails, sample_contacts, created_by)
        VALUES (${sqlLiteral(segment.id)}, ${sqlLiteral(segment.name)}, ${sqlLiteral(JSON.stringify(segment.criteria || {}))}::jsonb, ${Number(estimate.estimatedAudience || 0)}, ${sqlLiteral(JSON.stringify(contactEmails))}::jsonb, ${sqlLiteral(JSON.stringify(sampleContacts))}::jsonb, ${sqlLiteral(actorEmail)})
        RETURNING id::text, segment_id, segment_name, filter_json::text, audience_count::text, sample_contacts::text, created_by, created_at::text;
        UPDATE segments SET snapshot_count = snapshot_count + 1, last_snapshot_at = now(), estimated_audience = ${Number(estimate.estimatedAudience || 0)}, updated_at = now() WHERE id::text = ${sqlLiteral(segment.id)};
      `);
      const snapshot = snapshotFromPgRow(rows[0]);
      return { ok: true, mode: 'postgresql-local-psql-segment-snapshot', snapshot, estimate: { ...estimate, contacts: undefined }, persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
    } catch (error) {
      // safe fallback below
    }
  }

  const createdAt = nowIso();
  const snapshot = {
    id: `seg_snap_${(++snapshotSequence).toString().padStart(6, '0')}`,
    segmentId: segment.id,
    segmentName: segment.name,
    criteria: { ...(segment.criteria || {}) },
    audienceCount: estimate.estimatedAudience,
    contactEmails,
    sampleContacts,
    createdBy: actorEmail,
    createdAt,
    safety: { noDelivery: true, noContactMutation: true, reproducibleAudience: true, realDeliveryAllowed: false }
  };
  snapshots.set(snapshot.id, snapshot);
  const memorySegment = segments.get(segment.id);
  if (memorySegment) {
    memorySegment.snapshotCount = (memorySegment.snapshotCount || 0) + 1;
    memorySegment.lastSnapshotAt = createdAt;
    memorySegment.estimatedAudience = estimate.estimatedAudience;
    memorySegment.updatedAt = createdAt;
  }
  return { ok: true, mode: 'in-memory-segment-snapshot', snapshot: { ...snapshot, contactEmails: undefined }, estimate: { ...estimate, contacts: undefined }, persistenceMode: 'in-memory-until-postgresql-segments-enabled', realDeliveryAllowed: false };
};

export const listSegmentSnapshots = ({ segmentId = null } = {}) => {
  const cleanSegmentId = String(segmentId || '').trim();
  if (isPgRepositoryEnabled('segments')) {
    try {
      const where = cleanSegmentId ? `WHERE segment_id = ${sqlLiteral(cleanSegmentId)}` : '';
      const rows = runLocalPgRows(`
        SELECT id::text, segment_id, segment_name, filter_json::text, audience_count::text, sample_contacts::text, created_by, created_at::text
        FROM segment_snapshots
        ${where}
        ORDER BY created_at DESC
        LIMIT 50;
      `);
      return { ok: true, mode: 'postgresql-local-psql-segment-snapshots', count: rows.length, snapshots: rows.map(snapshotFromPgRow), persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
    } catch (error) {
      // fall through to memory
    }
  }
  const all = [...snapshots.values()]
    .filter((snapshot) => !cleanSegmentId || snapshot.segmentId === cleanSegmentId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50)
    .map(({ contactEmails, ...snapshot }) => ({ ...snapshot }));
  return { ok: true, mode: 'in-memory-segment-snapshots', count: all.length, snapshots: all, persistenceMode: 'in-memory-until-postgresql-segments-enabled', realDeliveryAllowed: false };
};
