const cleanEmail = (value) => String(value || '').trim().toLowerCase();

const roleCatalog = [
  {
    role: 'owner',
    scope: 'full_admin',
    permissions: ['manage_users', 'manage_email_config', 'manage_campaigns', 'view_reporting', 'view_audit_log', 'manage_data_sources']
  },
  {
    role: 'operator',
    scope: 'day_to_day_email_ops',
    permissions: ['manage_contacts', 'manage_segments', 'manage_templates', 'prepare_campaigns', 'view_reporting']
  },
  {
    role: 'analyst',
    scope: 'read_only_reporting',
    permissions: ['view_reporting', 'view_contacts_metadata']
  },
  {
    role: 'compliance',
    scope: 'compliance_review',
    permissions: ['view_audit_log', 'manage_suppressions', 'view_reporting', 'review_sending_readiness']
  }
];

export const rbacReadiness = (env = process.env) => {
  const adminEmail = cleanEmail(env.ORACLESTREET_ADMIN_EMAIL || 'admin@oraclestreet.local');
  const multiUserEnabled = String(env.ORACLESTREET_MULTI_USER_ENABLED || 'false').trim().toLowerCase() === 'true';
  const errors = [];

  if (!adminEmail || !adminEmail.includes('@')) errors.push('valid_admin_email_required');
  if (multiUserEnabled) errors.push('multi_user_must_remain_disabled_until_rbac_enforcement_exists');

  return {
    ok: errors.length === 0,
    mode: 'rbac-readiness-safe-gate',
    currentAccess: {
      model: 'single_admin_session',
      bootstrapAdminConfigured: Boolean(adminEmail),
      adminEmailDomain: adminEmail.split('@')[1] || null,
      multiUserEnabled: false
    },
    plannedRoles: roleCatalog,
    enforcement: {
      current: 'admin_session_required_for_protected_routes',
      multiUser: 'planned_locked',
      perRoutePermissions: 'planned_locked',
      invitationFlow: 'planned_locked',
      auditRoleChanges: 'planned_locked'
    },
    protectedSurfaces: [
      'email_provider_config',
      'send_queue',
      'campaigns',
      'contacts',
      'segments',
      'templates',
      'data_sources',
      'reporting',
      'audit_log',
      'readiness_gates'
    ],
    safety: {
      noUserMutation: true,
      noRoleMutation: true,
      noSecretOutput: true,
      realDeliveryAllowed: false
    },
    blockersBeforeMultiUser: [
      'persisted user table with password reset policy',
      'route-level permission middleware',
      'role-change audit events',
      'session invalidation on role changes',
      'least-privilege defaults for non-owner users'
    ],
    errors,
    realDeliveryAllowed: false
  };
};
