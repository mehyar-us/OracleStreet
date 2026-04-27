import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';
import { addSuppression } from './suppressions.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INGEST_TYPES = new Set(['bounce', 'complaint']);
const DELIVERY_TYPES = new Set(['delivered', 'deferred']);
const EVENT_TYPES = new Set(['bounce', 'complaint', 'dispatched', 'open', 'click', 'delivered', 'deferred']);
const TRACKING_TYPES = new Set(['open', 'click']);
const SUPPRESSION_TYPES = new Set(['bounce', 'complaint']);
const events = [];
let sequence = 0;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const nowIso = () => new Date().toISOString();

export const resetEmailEventsForTests = () => {
  events.length = 0;
  sequence = 0;
};

const pgRowToEvent = ([id, eventType, email, source, detail, campaignId, contactId, providerMessageId, actorEmail, createdAt]) => ({
  id,
  type: eventType,
  email,
  source: source || 'postgresql_event',
  detail: detail || null,
  campaignId: campaignId || null,
  contactId: contactId || null,
  providerMessageId: providerMessageId || null,
  actorEmail: actorEmail || null,
  createdAt
});

const listEmailEventsFromPostgres = () => runLocalPgRows(`
  SELECT id, event_type, coalesce(recipient_email, metadata->>'email', ''), coalesce(source, metadata->>'source', ''), coalesce(detail, metadata->>'detail', ''), coalesce(campaign_id, ''), coalesce(contact_id, ''), coalesce(provider_message_id, metadata->>'providerMessageId', ''), coalesce(actor_email, metadata->>'actorEmail', ''), created_at::text
  FROM email_events
  ORDER BY created_at DESC
  LIMIT 1000;
`).map(pgRowToEvent);

export const listEmailEvents = () => {
  if (isPgRepositoryEnabled('email_events')) {
    try {
      const pgEvents = listEmailEventsFromPostgres();
      return { ok: true, count: pgEvents.length, events: pgEvents, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory view
    }
  }
  return {
    ok: true,
    count: events.length,
    events: events.map((event) => ({ ...event })),
    persistenceMode: isPgRepositoryEnabled('email_events') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};

export const findEmailEventsByProviderMessageId = (providerMessageId) => {
  const cleanProviderMessageId = String(providerMessageId || '').trim();
  if (!cleanProviderMessageId) return { ok: false, error: 'provider_message_id_required' };
  if (cleanProviderMessageId.length > 200) return { ok: false, error: 'provider_message_id_too_long' };
  let matches = events.filter((event) => event.providerMessageId === cleanProviderMessageId);
  if (isPgRepositoryEnabled('email_events')) {
    try {
      matches = runLocalPgRows(`
        SELECT id, event_type, coalesce(recipient_email, metadata->>'email', ''), coalesce(source, metadata->>'source', ''), coalesce(detail, metadata->>'detail', ''), coalesce(campaign_id, ''), coalesce(contact_id, ''), coalesce(provider_message_id, metadata->>'providerMessageId', ''), coalesce(actor_email, metadata->>'actorEmail', ''), created_at::text
        FROM email_events
        WHERE provider_message_id = ${sqlLiteral(cleanProviderMessageId)} OR metadata->>'providerMessageId' = ${sqlLiteral(cleanProviderMessageId)}
        ORDER BY created_at DESC
        LIMIT 1000;
      `).map(pgRowToEvent);
    } catch (error) {
      // keep in-memory lookup fallback
    }
  }
  return {
    ok: true,
    mode: 'provider-message-event-lookup',
    providerMessageId: cleanProviderMessageId,
    count: matches.length,
    events: matches.map((event) => ({ ...event })),
    safety: {
      noNetworkProbe: true,
      noMailboxConnection: true,
      noEventRecorded: true,
      noSuppressionCreated: true,
      realDelivery: false
    },
    realDelivery: false
  };
};

export const recordEmailEvent = ({ type, email, source = 'manual_ingest', detail = null, campaignId = null, contactId = null, providerMessageId = null, actorEmail = null }) => {
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
    providerMessageId: providerMessageId ? String(providerMessageId).trim().slice(0, 200) : null,
    actorEmail,
    createdAt: nowIso()
  };

  let savedEvent = event;
  let persistedToPostgres = false;
  if (isPgRepositoryEnabled('email_events')) {
    try {
      const metadata = { email: normalized, source: cleanSource, detail: event.detail, providerMessageId: event.providerMessageId, actorEmail };
      const rows = runLocalPgRows(`
        INSERT INTO email_events (id, event_type, recipient_email, source, detail, campaign_id, contact_id, provider_message_id, actor_email, metadata)
        VALUES (${sqlLiteral(event.id)}, ${sqlLiteral(cleanType)}, ${sqlLiteral(normalized)}, ${sqlLiteral(cleanSource)}, ${sqlLiteral(event.detail)}, ${sqlLiteral(event.campaignId)}, ${sqlLiteral(event.contactId)}, ${sqlLiteral(event.providerMessageId)}, ${sqlLiteral(actorEmail)}, ${sqlLiteral(JSON.stringify(metadata))}::jsonb)
        RETURNING id, event_type, coalesce(recipient_email, metadata->>'email', ''), coalesce(source, metadata->>'source', ''), coalesce(detail, metadata->>'detail', ''), coalesce(campaign_id, ''), coalesce(contact_id, ''), coalesce(provider_message_id, metadata->>'providerMessageId', ''), coalesce(actor_email, metadata->>'actorEmail', ''), created_at::text;
      `);
      savedEvent = pgRowToEvent(rows[0]);
      persistedToPostgres = true;
    } catch (error) {
      events.push(event);
    }
  } else {
    events.push(event);
  }

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
    event: { ...savedEvent },
    suppression: suppression?.ok ? suppression.suppression : null,
    realDelivery: false,
    persistenceMode: persistedToPostgres ? 'postgresql-local-psql-repository' : (isPgRepositoryEnabled('email_events') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled')
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

export const ingestDeliveryEvents = ({ events: incomingEvents, actorEmail = null }) => {
  if (!Array.isArray(incomingEvents)) return { ok: false, error: 'events_array_required' };

  const accepted = [];
  const rejected = [];
  incomingEvents.forEach((incoming, index) => {
    const cleanType = String(incoming?.type || '').trim().toLowerCase();
    if (!DELIVERY_TYPES.has(cleanType)) {
      rejected.push({ index, email: normalizeEmail(incoming?.email) || null, errors: ['valid_delivery_event_type_required'] });
      return;
    }
    const result = recordEmailEvent({
      ...incoming,
      type: cleanType,
      source: incoming?.source || 'manual_delivery_ingest',
      actorEmail
    });
    if (result.ok) accepted.push(result);
    else rejected.push({ index, email: normalizeEmail(incoming?.email) || null, errors: result.errors });
  });

  return {
    ok: rejected.length === 0,
    mode: 'manual-delivery-event-ingest',
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted,
    rejected,
    suppressionCreated: false,
    realDelivery: false
  };
};

export const recordTrackingEvent = ({ type, email, campaignId = null, contactId = null, detail = null }) => {
  const cleanType = String(type || '').trim().toLowerCase();
  if (!TRACKING_TYPES.has(cleanType)) return { ok: false, errors: ['valid_tracking_type_required'] };
  return recordEmailEvent({
    type: cleanType,
    email,
    source: 'tracked_engagement',
    detail,
    campaignId,
    contactId,
    actorEmail: null
  });
};
