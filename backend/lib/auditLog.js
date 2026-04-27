import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';

const auditLog = [];
let sequence = 0;

const nowIso = () => new Date().toISOString();

const sanitizeDetails = (details = {}) => {
  const blocked = new Set(['password', 'token', 'secret', 'cookie', 'authorization']);
  return Object.fromEntries(
    Object.entries(details || {}).filter(([key]) => !blocked.has(String(key).toLowerCase()))
  );
};

export const resetAuditLogForTests = () => {
  auditLog.length = 0;
  sequence = 0;
};

export const recordAuditEvent = ({ action, actorEmail = null, target = null, status = 'ok', details = {} }) => {
  const event = {
    id: `aud_${(++sequence).toString().padStart(6, '0')}`,
    action: String(action || 'unknown'),
    actorEmail,
    target,
    status,
    details: sanitizeDetails(details),
    createdAt: nowIso()
  };
  if (isPgRepositoryEnabled('audit_log')) {
    try {
      runLocalPgRows(`
        INSERT INTO audit_log (app_event_id, action, entity_type, actor_email, target, status, metadata)
        VALUES (${sqlLiteral(event.id)}, ${sqlLiteral(event.action)}, 'admin_action', ${sqlLiteral(event.actorEmail)}, ${sqlLiteral(event.target)}, ${sqlLiteral(event.status)}, ${sqlLiteral(JSON.stringify(event.details))}::jsonb)
        ON CONFLICT (app_event_id) WHERE app_event_id IS NOT NULL DO NOTHING;
      `);
      return { ...event, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory audit so operator activity remains visible.
    }
  }
  auditLog.push(event);
  return { ...event, persistenceMode: isPgRepositoryEnabled('audit_log') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled' };
};

const cloneEvent = (event) => ({ ...event, details: { ...event.details } });

const pgRowToAuditEvent = ([id, action, actorEmail, target, status, detailsJson, createdAt]) => ({
  id,
  action,
  actorEmail: actorEmail || null,
  target: target || null,
  status,
  details: detailsJson ? JSON.parse(detailsJson) : {},
  createdAt
});

const listAuditLogFromPostgres = () => runLocalPgRows(`
  SELECT coalesce(app_event_id, id::text), action, coalesce(actor_email, ''), coalesce(target, ''), status, metadata::text, created_at::text
  FROM audit_log
  ORDER BY created_at DESC
  LIMIT 1000;
`).map(pgRowToAuditEvent);

export const listAuditLog = () => {
  if (isPgRepositoryEnabled('audit_log')) {
    try {
      const events = listAuditLogFromPostgres();
      return { ok: true, count: events.length, events, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory view
    }
  }
  return {
    ok: true,
    count: auditLog.length,
    events: auditLog.map(cloneEvent),
    persistenceMode: isPgRepositoryEnabled('audit_log') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};

export const listAuditEventsByActionPrefix = (prefix) => {
  const cleanPrefix = String(prefix || '').trim();
  let events = auditLog.filter((event) => event.action.startsWith(cleanPrefix)).map(cloneEvent);
  if (isPgRepositoryEnabled('audit_log')) {
    try {
      events = runLocalPgRows(`
        SELECT coalesce(app_event_id, id::text), action, coalesce(actor_email, ''), coalesce(target, ''), status, metadata::text, created_at::text
        FROM audit_log
        WHERE action LIKE ${sqlLiteral(`${cleanPrefix}%`)}
        ORDER BY created_at DESC
        LIMIT 1000;
      `).map(pgRowToAuditEvent);
    } catch (error) {
      // keep in-memory fallback
    }
  }
  return {
    ok: true,
    mode: 'filtered-audit-log',
    prefix: cleanPrefix,
    count: events.length,
    events,
    persistenceMode: isPgRepositoryEnabled('audit_log') ? 'postgresql-local-psql-repository' : 'in-memory-until-postgresql-connection-enabled'
  };
};
