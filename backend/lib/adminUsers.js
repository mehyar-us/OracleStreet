import crypto from 'node:crypto';
import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';

const sessions = new Map();

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

export const upsertAdminUser = ({ email, role = 'admin' } = {}) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return { ok: false, errors: ['email_required'] };
  if (isPgRepositoryEnabled('users')) {
    try {
      const rows = runLocalPgRows(`
        INSERT INTO users (email, role, updated_at)
        VALUES (${sqlLiteral(cleanEmail)}, ${sqlLiteral(role)}, now())
        ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, updated_at = now()
        RETURNING id::text, email, role, created_at::text, updated_at::text;
      `);
      const [id, savedEmail, savedRole, createdAt, updatedAt] = rows[0];
      return { ok: true, mode: 'postgresql-admin-user', user: { id, email: savedEmail, role: savedRole, createdAt, updatedAt }, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to env-backed admin identity
    }
  }
  return { ok: true, mode: 'env-admin-user', user: { email: cleanEmail, role }, persistenceMode: isPgRepositoryEnabled('users') ? 'postgresql-error-fallback-env' : 'env-until-postgresql-connection-enabled' };
};

export const recordAdminSession = ({ token, email, expiresAt } = {}) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const id = hashToken(token);
  if (!cleanEmail || !token || !expiresAt) return { ok: false, errors: ['session_token_email_expiry_required'] };
  if (isPgRepositoryEnabled('admin_sessions')) {
    try {
      runLocalPgRows(`
        INSERT INTO admin_sessions (id, email, expires_at)
        VALUES (${sqlLiteral(id)}, ${sqlLiteral(cleanEmail)}, ${sqlLiteral(expiresAt)})
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, expires_at = EXCLUDED.expires_at, revoked_at = NULL;
      `);
      return { ok: true, mode: 'postgresql-admin-session', sessionId: id.slice(0, 12), persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to memory
    }
  }
  sessions.set(id, { email: cleanEmail, expiresAt, revokedAt: null, createdAt: new Date().toISOString() });
  return { ok: true, mode: 'in-memory-admin-session', sessionId: id.slice(0, 12), persistenceMode: isPgRepositoryEnabled('admin_sessions') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled' };
};

export const revokeAdminSession = (token) => {
  if (!token) return { ok: false, errors: ['session_token_required'] };
  const id = hashToken(token);
  if (isPgRepositoryEnabled('admin_sessions')) {
    try {
      runLocalPgRows(`UPDATE admin_sessions SET revoked_at = now() WHERE id = ${sqlLiteral(id)};`);
      return { ok: true, mode: 'postgresql-admin-session-revoke', persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to memory
    }
  }
  const existing = sessions.get(id);
  if (existing) sessions.set(id, { ...existing, revokedAt: new Date().toISOString() });
  return { ok: true, mode: 'in-memory-admin-session-revoke', persistenceMode: isPgRepositoryEnabled('admin_sessions') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled' };
};
