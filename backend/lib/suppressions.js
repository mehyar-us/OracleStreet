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

export const listSuppressions = () => ({
  ok: true,
  count: suppressions.size,
  suppressions: [...suppressions.values()].map((entry) => ({ ...entry }))
});

export const isSuppressed = (email) => suppressions.has(normalizeEmail(email));

export const getSuppression = (email) => suppressions.get(normalizeEmail(email)) || null;

export const addSuppression = ({ email, reason = 'manual', source = 'admin', actorEmail = null }) => {
  const normalized = normalizeEmail(email);
  const cleanReason = String(reason || '').trim().toLowerCase();
  const cleanSource = String(source || '').trim();
  const errors = [];

  if (!EMAIL_RE.test(normalized)) errors.push('valid_email_required');
  if (!ALLOWED_REASONS.has(cleanReason)) errors.push('valid_suppression_reason_required');
  if (!cleanSource) errors.push('source_required');
  if (errors.length > 0) return { ok: false, errors };

  const existing = suppressions.get(normalized);
  if (existing) {
    const updated = { ...existing, reason: cleanReason, source: cleanSource, actorEmail, updatedAt: nowIso() };
    suppressions.set(normalized, updated);
    return { ok: true, suppression: { ...updated }, created: false };
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
  return { ok: true, suppression: { ...suppression }, created: true };
};

export const recordUnsubscribe = ({ email, source = 'unsubscribe_endpoint' }) => addSuppression({
  email,
  reason: 'unsubscribe',
  source,
  actorEmail: null
});
