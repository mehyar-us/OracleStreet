import crypto from 'node:crypto';
import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';

const sessions = new Map();
const memoryUsers = new Map();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = new Set(['owner', 'admin', 'operator', 'analyst', 'compliance', 'read_only']);
const MIN_SECRET_LENGTH = 16;
const MIN_PASSWORD_LENGTH = 12;
export const ROLE_MATRIX = [
  { role: 'owner', permissions: ['manage_users', 'manage_platform', 'manage_contacts', 'manage_segments', 'manage_templates', 'manage_campaigns', 'manage_suppressions', 'manage_data_sources', 'review_sending_readiness', 'view_reporting', 'view_contacts_metadata', 'view_audit_log'] },
  { role: 'admin', permissions: ['manage_users', 'manage_platform', 'manage_contacts', 'manage_segments', 'manage_templates', 'manage_campaigns', 'manage_suppressions', 'manage_data_sources', 'review_sending_readiness', 'view_reporting', 'view_contacts_metadata', 'view_audit_log'] },
  { role: 'operator', permissions: ['manage_contacts', 'manage_segments', 'manage_templates', 'prepare_campaigns', 'view_reporting', 'view_contacts_metadata'] },
  { role: 'analyst', permissions: ['view_reporting', 'view_contacts_metadata'] },
  { role: 'compliance', permissions: ['manage_suppressions', 'review_sending_readiness', 'view_audit_log', 'view_reporting'] },
  { role: 'read_only', permissions: ['view_reporting', 'view_contacts_metadata', 'view_audit_log'] }
];

export const permissionsForRole = (role) => ROLE_MATRIX.find((entry) => entry.role === String(role || '').trim().toLowerCase())?.permissions || [];

export const roleHasPermission = (role, permission) => permissionsForRole(role).includes(permission);

export const resetAdminUsersForTests = () => {
  sessions.clear();
  memoryUsers.clear();
};

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = crypto.scryptSync(String(password || ''), salt, 64).toString('base64url');
  return `scrypt$${salt}$${key}`;
};

const verifyPasswordHash = (password, storedHash) => {
  const [algorithm, salt, expected] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 64).toString('base64url');
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const strongSecretErrors = (value, field) => {
  const clean = String(value || '');
  const errors = [];
  if (clean.length < MIN_SECRET_LENGTH) errors.push(`${field}_min_${MIN_SECRET_LENGTH}_chars`);
  if (!/[a-z]/i.test(clean) || !/[0-9]/.test(clean)) errors.push(`${field}_letters_and_numbers_required`);
  return errors;
};

const passwordErrors = (password) => {
  const clean = String(password || '');
  const errors = [];
  if (clean.length < MIN_PASSWORD_LENGTH) errors.push(`password_min_${MIN_PASSWORD_LENGTH}_chars`);
  if (!/[a-z]/i.test(clean) || !/[0-9]/.test(clean)) errors.push('password_letters_and_numbers_required');
  return errors;
};

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

const pgRowToUser = ([id, email, role, hasPassword, status, invitePending, resetPending, createdAt, updatedAt]) => ({
  id,
  email,
  role,
  status: status || (hasPassword === 't' || hasPassword === true ? 'password_configured' : 'bootstrap_or_invite_pending'),
  hasPassword: hasPassword === 't' || hasPassword === true,
  invitePending: invitePending === 't' || invitePending === true,
  resetPending: resetPending === 't' || resetPending === true,
  createdAt,
  updatedAt: updatedAt || null
});

export const getAdminUserRole = (email, env = process.env) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return null;
  if (isPgRepositoryEnabled('users')) {
    try {
      const rows = runLocalPgRows(`
        SELECT role
        FROM users
        WHERE email = ${sqlLiteral(cleanEmail)}
        LIMIT 1;
      `);
      if (rows[0]?.[0]) return rows[0][0];
    } catch (error) {
      // fall through to bootstrap/default role
    }
  }
  const bootstrapEmail = String(env.ORACLESTREET_ADMIN_EMAIL || 'admin@oraclestreet.local').trim().toLowerCase();
  if (cleanEmail === bootstrapEmail) return String(env.ORACLESTREET_BOOTSTRAP_ADMIN_ROLE || 'admin').trim().toLowerCase();
  if (memoryUsers.has(cleanEmail)) return memoryUsers.get(cleanEmail).role;
  return null;
};

export const listAdminUsers = (env = process.env) => {
  const bootstrapEmail = String(env.ORACLESTREET_ADMIN_EMAIL || 'admin@oraclestreet.local').trim().toLowerCase();
  if (isPgRepositoryEnabled('users')) {
    try {
      const users = runLocalPgRows(`
        SELECT id::text, email, role, (password_hash IS NOT NULL)::text, status, (invite_token_hash IS NOT NULL AND invite_expires_at > now())::text, (reset_token_hash IS NOT NULL AND reset_expires_at > now())::text, created_at::text, updated_at::text
        FROM users
        ORDER BY created_at ASC, email ASC
        LIMIT 200;
      `).map(pgRowToUser);
      return { ok: true, mode: 'admin-user-directory', count: users.length, users, roleMatrix: ROLE_MATRIX, persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
    } catch (error) {
      // fall through to bootstrap-only view
    }
  }
  const memoryUserList = [...memoryUsers.values()].map((user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    hasPassword: Boolean(user.passwordHash),
    invitePending: user.status === 'invite_pending',
    resetPending: Boolean(user.resetHash),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  }));
  return {
    ok: true,
    mode: 'admin-user-directory',
    count: (bootstrapEmail ? 1 : 0) + memoryUserList.length,
    users: [...(bootstrapEmail ? [{ id: 'bootstrap-admin', email: bootstrapEmail, role: String(env.ORACLESTREET_BOOTSTRAP_ADMIN_ROLE || 'admin').trim().toLowerCase(), status: 'bootstrap_env_admin', hasPassword: false, createdAt: null, updatedAt: null }] : []), ...memoryUserList],
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

export const createAdminUserInvite = ({ email, role = 'operator', inviteCode, expiresInHours = 24, requestedBy = null } = {}, env = process.env) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanRole = String(role || '').trim().toLowerCase();
  const requester = String(requestedBy || '').trim().toLowerCase();
  const hours = Number(expiresInHours || 24);
  const errors = [];
  if (!EMAIL_RE.test(cleanEmail)) errors.push('valid_user_email_required');
  if (!ALLOWED_ROLES.has(cleanRole)) errors.push('valid_role_required');
  if (!requester) errors.push('requesting_admin_required');
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) errors.push('invite_expiry_hours_1_168_required');
  errors.push(...strongSecretErrors(inviteCode, 'invite_code'));
  const existing = listAdminUsers(env).users.find((user) => user.email === cleanEmail && user.hasPassword);
  if (existing) errors.push('user_already_active');
  if (errors.length > 0) return { ok: false, mode: 'admin-user-invite-create', errors, userMutation: false, realDeliveryAllowed: false };

  if (!isPgRepositoryEnabled('users')) {
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const user = { id: `memory_user_${memoryUsers.size + 1}`, email: cleanEmail, role: cleanRole, status: 'invite_pending', inviteHash: hashToken(inviteCode), inviteExpiresAt: expiresAt, passwordHash: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    memoryUsers.set(cleanEmail, user);
    return { ok: true, mode: 'admin-user-invite-create', invite: { id: user.id, email: user.email, role: user.role, status: user.status, inviteExpiresAt: expiresAt, delivery: 'manual_out_of_band_only', tokenDisplayed: false, passwordDisplayed: false, accepted: false }, safety: { noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, noRawInviteCodeStored: true, realDeliveryAllowed: false }, persistenceMode: 'in-memory-until-postgresql-users-enabled', realDeliveryAllowed: false };
  }

  try {
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const inviteHash = hashToken(inviteCode);
    const rows = runLocalPgRows(`
      INSERT INTO users (email, role, status, invited_by, invite_token_hash, invite_expires_at, updated_at)
      VALUES (${sqlLiteral(cleanEmail)}, ${sqlLiteral(cleanRole)}, 'invite_pending', ${sqlLiteral(requester)}, ${sqlLiteral(inviteHash)}, ${sqlLiteral(expiresAt)}, now())
      ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = 'invite_pending', invited_by = EXCLUDED.invited_by, invite_token_hash = EXCLUDED.invite_token_hash, invite_expires_at = EXCLUDED.invite_expires_at, updated_at = now()
      RETURNING id::text, email, role, status, invite_expires_at::text;
    `);
    const [id, savedEmail, savedRole, status, inviteExpiresAt] = rows[0];
    return {
      ok: true,
      mode: 'admin-user-invite-create',
      invite: { id, email: savedEmail, role: savedRole, status, inviteExpiresAt, delivery: 'manual_out_of_band_only', tokenDisplayed: false, passwordDisplayed: false, accepted: false },
      safety: { noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, noRawInviteCodeStored: true, realDeliveryAllowed: false },
      persistenceMode: 'postgresql-local-psql-repository',
      realDeliveryAllowed: false
    };
  } catch (error) {
    return { ok: false, mode: 'admin-user-invite-create', errors: ['postgresql_user_invite_save_failed'], userMutation: false, realDeliveryAllowed: false };
  }
};

export const acceptAdminUserInvite = ({ email, inviteCode, password } = {}) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const errors = [];
  if (!EMAIL_RE.test(cleanEmail)) errors.push('valid_user_email_required');
  errors.push(...strongSecretErrors(inviteCode, 'invite_code'));
  errors.push(...passwordErrors(password));
  if (errors.length > 0) return { ok: false, mode: 'admin-user-invite-acceptance', errors, userMutation: false, realDeliveryAllowed: false };

  if (!isPgRepositoryEnabled('users')) {
    const user = memoryUsers.get(cleanEmail);
    const blockers = [];
    if (!user || user.status !== 'invite_pending') blockers.push('pending_invite_not_found');
    if (user?.inviteExpiresAt && new Date(user.inviteExpiresAt).getTime() < Date.now()) blockers.push('invite_expired');
    if (user?.inviteHash && hashToken(inviteCode) !== user.inviteHash) blockers.push('invite_code_mismatch');
    if (blockers.length > 0) return { ok: false, mode: 'admin-user-invite-acceptance', errors: blockers, userMutation: false, realDeliveryAllowed: false };
    const acceptedAt = new Date().toISOString();
    const saved = { ...user, status: 'active', passwordHash: hashPassword(password), inviteHash: null, inviteExpiresAt: null, acceptedAt, updatedAt: acceptedAt };
    memoryUsers.set(cleanEmail, saved);
    return { ok: true, mode: 'admin-user-invite-acceptance', user: { id: saved.id, email: saved.email, role: saved.role, status: saved.status, acceptedAt, hasPassword: true }, safety: { noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, realDeliveryAllowed: false }, persistenceMode: 'in-memory-until-postgresql-users-enabled', realDeliveryAllowed: false };
  }

  try {
    const rows = runLocalPgRows(`
      SELECT invite_token_hash, invite_expires_at::text
      FROM users
      WHERE email = ${sqlLiteral(cleanEmail)} AND status = 'invite_pending'
      LIMIT 1;
    `);
    const [storedHash, expiresAt] = rows[0] || [];
    const blockers = [];
    if (!storedHash) blockers.push('pending_invite_not_found');
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) blockers.push('invite_expired');
    if (storedHash && hashToken(inviteCode) !== storedHash) blockers.push('invite_code_mismatch');
    if (blockers.length > 0) return { ok: false, mode: 'admin-user-invite-acceptance', errors: blockers, userMutation: false, realDeliveryAllowed: false };
    const passwordHash = hashPassword(password);
    const updated = runLocalPgRows(`
      UPDATE users
      SET password_hash = ${sqlLiteral(passwordHash)}, status = 'active', invite_token_hash = NULL, invite_expires_at = NULL, accepted_at = now(), password_set_at = now(), updated_at = now()
      WHERE email = ${sqlLiteral(cleanEmail)}
      RETURNING id::text, email, role, status, accepted_at::text;
    `);
    const [id, savedEmail, role, status, acceptedAt] = updated[0];
    return { ok: true, mode: 'admin-user-invite-acceptance', user: { id, email: savedEmail, role, status, acceptedAt, hasPassword: true }, safety: { noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, realDeliveryAllowed: false }, persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
  } catch (error) {
    return { ok: false, mode: 'admin-user-invite-acceptance', errors: ['postgresql_user_invite_accept_failed'], userMutation: false, realDeliveryAllowed: false };
  }
};

export const createPasswordResetPlan = ({ email, resetCode, expiresInHours = 2, requestedBy = null } = {}) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const requester = String(requestedBy || '').trim().toLowerCase();
  const hours = Number(expiresInHours || 2);
  const errors = [];
  if (!EMAIL_RE.test(cleanEmail)) errors.push('valid_user_email_required');
  if (!requester) errors.push('requesting_admin_required');
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) errors.push('reset_expiry_hours_1_72_required');
  errors.push(...strongSecretErrors(resetCode, 'reset_code'));
  if (errors.length > 0) return { ok: false, mode: 'admin-user-password-reset-plan', errors, userMutation: false, realDeliveryAllowed: false };
  if (!isPgRepositoryEnabled('users')) {
    const user = memoryUsers.get(cleanEmail);
    if (!user) return { ok: false, mode: 'admin-user-password-reset-plan', errors: ['user_not_found'], userMutation: false, realDeliveryAllowed: false };
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const saved = { ...user, resetHash: hashToken(resetCode), resetExpiresAt: expiresAt, updatedAt: new Date().toISOString() };
    memoryUsers.set(cleanEmail, saved);
    return { ok: true, mode: 'admin-user-password-reset-plan', reset: { id: saved.id, email: saved.email, role: saved.role, status: saved.status, resetExpiresAt: expiresAt, delivery: 'manual_out_of_band_only', tokenDisplayed: false }, safety: { noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, noRawResetCodeStored: true, realDeliveryAllowed: false }, persistenceMode: 'in-memory-until-postgresql-users-enabled', realDeliveryAllowed: false };
  }
  try {
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const rows = runLocalPgRows(`
      UPDATE users
      SET reset_token_hash = ${sqlLiteral(hashToken(resetCode))}, reset_expires_at = ${sqlLiteral(expiresAt)}, reset_requested_by = ${sqlLiteral(requester)}, updated_at = now()
      WHERE email = ${sqlLiteral(cleanEmail)}
      RETURNING id::text, email, role, status, reset_expires_at::text;
    `);
    if (!rows[0]) return { ok: false, mode: 'admin-user-password-reset-plan', errors: ['user_not_found'], userMutation: false, realDeliveryAllowed: false };
    const [id, savedEmail, role, status, resetExpiresAt] = rows[0];
    return { ok: true, mode: 'admin-user-password-reset-plan', reset: { id, email: savedEmail, role, status, resetExpiresAt, delivery: 'manual_out_of_band_only', tokenDisplayed: false }, safety: { noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, noRawResetCodeStored: true, realDeliveryAllowed: false }, persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
  } catch (error) {
    return { ok: false, mode: 'admin-user-password-reset-plan', errors: ['postgresql_password_reset_save_failed'], userMutation: false, realDeliveryAllowed: false };
  }
};

export const completePasswordReset = ({ email, resetCode, password } = {}) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const errors = [];
  if (!EMAIL_RE.test(cleanEmail)) errors.push('valid_user_email_required');
  errors.push(...strongSecretErrors(resetCode, 'reset_code'));
  errors.push(...passwordErrors(password));
  if (errors.length > 0) return { ok: false, mode: 'admin-user-password-reset-complete', errors, userMutation: false, realDeliveryAllowed: false };
  if (!isPgRepositoryEnabled('users')) {
    const user = memoryUsers.get(cleanEmail);
    const blockers = [];
    if (!user?.resetHash) blockers.push('password_reset_not_found');
    if (user?.resetExpiresAt && new Date(user.resetExpiresAt).getTime() < Date.now()) blockers.push('password_reset_expired');
    if (user?.resetHash && hashToken(resetCode) !== user.resetHash) blockers.push('reset_code_mismatch');
    if (blockers.length > 0) return { ok: false, mode: 'admin-user-password-reset-complete', errors: blockers, userMutation: false, realDeliveryAllowed: false };
    const passwordSetAt = new Date().toISOString();
    const saved = { ...user, passwordHash: hashPassword(password), status: 'active', resetHash: null, resetExpiresAt: null, passwordSetAt, updatedAt: passwordSetAt };
    memoryUsers.set(cleanEmail, saved);
    return { ok: true, mode: 'admin-user-password-reset-complete', user: { id: saved.id, email: saved.email, role: saved.role, status: saved.status, passwordSetAt, hasPassword: true }, safety: { noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, realDeliveryAllowed: false }, persistenceMode: 'in-memory-until-postgresql-users-enabled', realDeliveryAllowed: false };
  }
  try {
    const rows = runLocalPgRows(`SELECT reset_token_hash, reset_expires_at::text FROM users WHERE email = ${sqlLiteral(cleanEmail)} LIMIT 1;`);
    const [storedHash, expiresAt] = rows[0] || [];
    const blockers = [];
    if (!storedHash) blockers.push('password_reset_not_found');
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) blockers.push('password_reset_expired');
    if (storedHash && hashToken(resetCode) !== storedHash) blockers.push('reset_code_mismatch');
    if (blockers.length > 0) return { ok: false, mode: 'admin-user-password-reset-complete', errors: blockers, userMutation: false, realDeliveryAllowed: false };
    const passwordHash = hashPassword(password);
    const updated = runLocalPgRows(`
      UPDATE users
      SET password_hash = ${sqlLiteral(passwordHash)}, status = 'active', reset_token_hash = NULL, reset_expires_at = NULL, password_set_at = now(), updated_at = now()
      WHERE email = ${sqlLiteral(cleanEmail)}
      RETURNING id::text, email, role, status, password_set_at::text;
    `);
    const [id, savedEmail, role, status, passwordSetAt] = updated[0];
    return { ok: true, mode: 'admin-user-password-reset-complete', user: { id, email: savedEmail, role, status, passwordSetAt, hasPassword: true }, safety: { noEmailSent: true, noTokenOutput: true, noPasswordOutput: true, realDeliveryAllowed: false }, persistenceMode: 'postgresql-local-psql-repository', realDeliveryAllowed: false };
  } catch (error) {
    return { ok: false, mode: 'admin-user-password-reset-complete', errors: ['postgresql_password_reset_complete_failed'], userMutation: false, realDeliveryAllowed: false };
  }
};

export const verifyAdminUserPassword = ({ email, password } = {}) => {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !password) return { ok: false };
  if (!isPgRepositoryEnabled('users')) {
    const user = memoryUsers.get(cleanEmail);
    if (!user?.passwordHash || user.status !== 'active') return { ok: false };
    return { ok: verifyPasswordHash(password, user.passwordHash), role: user.role, status: user.status };
  }
  try {
    const rows = runLocalPgRows(`SELECT password_hash, role, status FROM users WHERE email = ${sqlLiteral(cleanEmail)} LIMIT 1;`);
    const [passwordHash, role, status] = rows[0] || [];
    if (!passwordHash || status !== 'active') return { ok: false };
    return { ok: verifyPasswordHash(password, passwordHash), role, status };
  } catch (error) {
    return { ok: false };
  }
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
