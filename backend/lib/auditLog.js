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
  auditLog.push(event);
  return { ...event };
};

export const listAuditLog = () => ({
  ok: true,
  count: auditLog.length,
  events: auditLog.map((event) => ({ ...event, details: { ...event.details } }))
});
