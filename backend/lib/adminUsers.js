import crypto from 'node:crypto';
import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';

const sessions = new Map();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = new Set(['owner', 'admin', 'operator', 'analyst', 'compliance', 'read_only']);
const ROLE_MATRIX = [
  { role: 'owner', permissions: ['manage_users', 'manage_platform', 'manage_campaigns', 'manage_data_sources', 'view_reporting', 'view_audit_log'] },
  { role: 'admin', permissions: ['manage_users', 'manage_contacts', 'manage_campaigns', 'manage_suppressions', 'view_reporting', 'view_audit_log'] },
  { role: 'operator', permissions: ['manage_contacts', 'manage_segments', 'manage_templates', 'prepare_campaigns', 'view_reporting'] },
  { role: 'analyst', permissions: ['view_reporting', 'view_contacts_metadata'] },
  { role: 'compliance', permissions: ['manage_suppressions', 'review_sending_readiness', 'view_audit_log', 'view_reporting'] },
  { role: 'read_only', permissions: ['view_reporting', 'view_contacts_metadata', 'view_audit_log'] }
];

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

const pgRowToUser = ([id, email, role, hasPassword, createdAt, updatedAt]) => ({
  id,
  email,
  role,
  status: hasPassword === 't' || hasPassword === true ? 'password_configured' : 'bootstrap_or_invite_pending',
  hasPassword: hasPassword === 't' || hasPassword === true,
  createdAt,
  updatedAt: updatedAt || null
});

export const listAdminUsers = (env = process.env) => {
  const bootstrapEmail = String(env.ORACLESTREET_ADMIN_EMAIL || 'admin@oraclestreet.local').trim().toLowerCase();
  if (isPgRepositoryEnabled('users')) {
    try {
      const users = runLocalPgRows(`
        SELECT id::text, email, role, (password_hash IS NOT NULL)::text, created_at::text, updated_at::text
        FROM users
        ORDER BY created_at ASC, email ASC
        LIMIT 200;
      `).map(pgRowToUser);
      return { ok: true, mode: 'admin-user-directory', count: users.length, users, roleMatrix: ROLE_MATRIX, persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
    } catch (error) {
      // fall through to bootstrap-only view
    }
  }
  return {
    ok: true,
    mode: 'admin-user-directory',
    count: bootstrapEmail ? 1 : 0,
    users: bootstrapEmail ? [{ id: 'bootstrap-admin', email: bootstrapEmail, role: 'admin', status: 'bootstrap_env_admin', hasPassword: false, createdAt: null, updatedAt: null }] : [],
    roleMatrix: ROLE_MATRIX,
    persistenceMode: isPgRepositoryEnabled('users') ? 'postgresql-error-fallback-bootstrap-env' : 'env-until-postgresql-connection-enabled',
    realDeliveryAllowed: false
  };
};

export const planAdminUserInvite = ({ email, role = 'operator', requestedBy = null } = {}, env = process.env) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanRole = String(role || '').trim().toLowerCase();
  const requester = String(requestedBy || '').trim().toLowerCase();
  const errors = [];
  if (!EMAIL_RE.test(cleanEmail)) errors.push('valid_user_email_required');
  if (!ALLOWED_ROLES.has(cleanRole)) errors.push('valid_role_required');
  if (!['owner', 'admin', 'operator', 'analyst', 'compliance', 'read_only'].includes(cleanRole)) errors.push('supported_role_required');
  if (!requester) errors.push('requesting_admin_required');
  const existing = listAdminUsers(env).users.find((user) => user.email === cleanEmail);
  if (existing) errors.push('user_already_exists_or_bootstrap_admin');
  if (errors.length > 0) return { ok: false, mode: 'admin-user-invite-plan', errors, realDeliveryAllowed: false };
  return {
    ok: true,
    mode: 'admin-user-invite-plan',
    invite: {
      email: cleanEmail,
      role: cleanRole,
      status: 'planned_not_sent',
      requestedBy: requester,
      expiresInHours: 24,
      delivery: 'manual_out_of_band_only',
      tokenDisplayed: false,
      passwordDisplayed: false,
      userMutation: false
    },
    roleMatrix: ROLE_MATRIX,
    safety: {
      noEmailSent: true,
      noUserMutation: true,
      noPasswordGenerated: true,
      noTokenOutput: true,
      auditRequired: true,
      realDeliveryAllowed: false
    },
    persistenceMode: listAdminUsers(env).persistenceMode,
    realDeliveryAllowed: false
  };
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
