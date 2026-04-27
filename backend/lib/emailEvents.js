import { addSuppression } from './suppressions.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INGEST_TYPES = new Set(['bounce', 'complaint']);
const EVENT_TYPES = new Set(['bounce', 'complaint', 'dispatched']);
const SUPPRESSION_TYPES = new Set(['bounce', 'complaint']);
const events = [];
let sequence = 0;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const nowIso = () => new Date().toISOString();

export const resetEmailEventsForTests = () => {
  events.length = 0;
  sequence = 0;
};

export const listEmailEvents = () => ({
  ok: true,
  count: events.length,
  events: events.map((event) => ({ ...event }))
});

export const recordEmailEvent = ({ type, email, source = 'manual_ingest', detail = null, campaignId = null, contactId = null, actorEmail = null }) => {
  const cleanType = String(type || '').trim().toLowerCase();
  const normalized = normalizeEmail(email);
  const cleanSource = String(source || '').trim();
  const errors = [];

  if (!EVENT_TYPES.has(cleanType)) errors.push('valid_event_type_required');
  if (!EMAIL_RE.test(normalized)) errors.push('valid_email_required');
  if (!cleanSource) errors.push('source_required');
  if (errors.length > 0) return { ok: false, errors };

  const event = {
    id: `evt_${(++sequence).toString().padStart(6, '0')}`,
    type: cleanType,
    email: normalized,
    source: cleanSource,
    detail: detail ? String(detail).slice(0, 500) : null,
    campaignId: campaignId ? String(campaignId).trim() : null,
    contactId: contactId ? String(contactId).trim() : null,
    actorEmail,
    createdAt: nowIso()
  };
  events.push(event);

  const suppression = SUPPRESSION_TYPES.has(cleanType)
    ? addSuppression({
      email: normalized,
      reason: cleanType,
      source: `${cleanSource}:${cleanType}`,
      actorEmail
    })
    : null;

  return {
    ok: true,
    event: { ...event },
    suppression: suppression?.ok ? suppression.suppression : null,
    realDelivery: false
  };
};

export const ingestEmailEvents = ({ events: incomingEvents, actorEmail = null }) => {
  if (!Array.isArray(incomingEvents)) return { ok: false, error: 'events_array_required' };

  const accepted = [];
  const rejected = [];
  incomingEvents.forEach((incoming, index) => {
    const cleanType = String(incoming?.type || '').trim().toLowerCase();
    if (!INGEST_TYPES.has(cleanType)) {
      rejected.push({ index, email: normalizeEmail(incoming?.email) || null, errors: ['valid_event_type_required'] });
      return;
    }
    const result = recordEmailEvent({ ...incoming, actorEmail });
    if (result.ok) accepted.push(result);
    else rejected.push({ index, email: normalizeEmail(incoming?.email) || null, errors: result.errors });
  });

  return {
    ok: rejected.length === 0,
    mode: 'manual-safe-ingest',
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted,
    rejected
  };
};
