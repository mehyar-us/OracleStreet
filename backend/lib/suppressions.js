import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_REASONS = new Set(['unsubscribe', 'bounce', 'complaint', 'manual']);

const suppressions = new Map();
let sequence = 0;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const nowIso = () => new Date().toISOString();

export const resetSuppressionsForTests = () => {
  suppressions.clear();
  sequence = 0;
};

const pgRowToSuppression = ([id, email, reason, source, createdAt]) => ({
  id,
  email,
  reason,
  source,
  actorEmail: null,
  createdAt,
  updatedAt: null
});

const listSuppressionsFromPostgres = () => runLocalPgRows(`
  SELECT id::text, email, reason, source, created_at::text
  FROM suppressions
  ORDER BY created_at DESC, email ASC
  LIMIT 1000;
`).map(pgRowToSuppression);

const getSuppressionFromPostgres = (email) => {
  const rows = runLocalPgRows(`
    SELECT id::text, email, reason, source, created_at::text
    FROM suppressions
    WHERE email = ${sqlLiteral(normalizeEmail(email))}
    ORDER BY created_at DESC
    LIMIT 1;
  `);
  return rows[0] ? pgRowToSuppression(rows[0]) : null;
};

export const listSuppressions = () => {
  if (isPgRepositoryEnabled('suppressions')) {
    try {
      const pgSuppressions = listSuppressionsFromPostgres();
      return { ok: true, count: pgSuppressions.length, suppressions: pgSuppressions, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory view
    }
  }
  return {
    ok: true,
    count: suppressions.size,
    suppressions: [...suppressions.values()].map((entry) => ({ ...entry })),
    persistenceMode: isPgRepositoryEnabled('suppressions') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};

export const isSuppressed = (email) => {
  if (isPgRepositoryEnabled('suppressions')) {
    try { return Boolean(getSuppressionFromPostgres(email)); } catch (error) { /* fall through */ }
  }
  return suppressions.has(normalizeEmail(email));
};

export const getSuppression = (email) => {
  if (isPgRepositoryEnabled('suppressions')) {
    try { return getSuppressionFromPostgres(email); } catch (error) { /* fall through */ }
  }
  return suppressions.get(normalizeEmail(email)) || null;
};

export const addSuppression = ({ email, reason = 'manual', source = 'admin', actorEmail = null }) => {
  const normalized = normalizeEmail(email);
  const cleanReason = String(reason || '').trim().toLowerCase();
  const cleanSource = String(source || '').trim();
  const errors = [];

  if (!EMAIL_RE.test(normalized)) errors.push('valid_email_required');
  if (!ALLOWED_REASONS.has(cleanReason)) errors.push('valid_suppression_reason_required');
  if (!cleanSource) errors.push('source_required');
  if (errors.length > 0) return { ok: false, errors };

  if (isPgRepositoryEnabled('suppressions')) {
    try {
      const existing = getSuppressionFromPostgres(normalized);
      const rows = runLocalPgRows(`
        DELETE FROM suppressions WHERE email = ${sqlLiteral(normalized)};
        INSERT INTO suppressions (email, reason, source)
        VALUES (${sqlLiteral(normalized)}, ${sqlLiteral(cleanReason)}, ${sqlLiteral(cleanSource)})
        RETURNING id::text, email, reason, source, created_at::text;
      `);
      return { ok: true, suppression: pgRowToSuppression(rows[0]), created: !existing, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory suppression so compliance remains fail-closed for this process
    }
  }

  const existing = suppressions.get(normalized);
  if (existing) {
    const updated = { ...existing, reason: cleanReason, source: cleanSource, actorEmail, updatedAt: nowIso() };
    suppressions.set(normalized, updated);
    return { ok: true, suppression: { ...updated }, created: false, persistenceMode: isPgRepositoryEnabled('suppressions') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled' };
  }

  const suppression = {
    id: `sup_${(++sequence).toString().padStart(6, '0')}`,
    email: normalized,
    reason: cleanReason,
    source: cleanSource,
    actorEmail,
    createdAt: nowIso(),
    updatedAt: null
  };
  suppressions.set(normalized, suppression);
  return { ok: true, suppression: { ...suppression }, created: true, persistenceMode: isPgRepositoryEnabled('suppressions') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled' };
};

export const recordUnsubscribe = ({ email, source = 'unsubscribe_endpoint' }) => addSuppression({
  email,
  reason: 'unsubscribe',
  source,
  actorEmail: null
});
