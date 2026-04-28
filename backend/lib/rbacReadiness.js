import { ROLE_MATRIX } from './adminUsers.js';

const cleanEmail = (value) => String(value || '').trim().toLowerCase();

export const RBAC_ROUTE_POLICY = [
  { surface: 'admin_users', permission: 'manage_users', routes: ['GET /api/admin/users', 'POST /api/admin/users/invite-plan', 'POST /api/admin/users/invite', 'POST /api/admin/users/password-reset-plan'] },
  { surface: 'audit_log', permission: 'view_audit_log', routes: ['GET /api/audit-log'] },
  { surface: 'contacts', permission: 'manage_contacts', routes: ['POST /api/contacts/import', 'POST /api/contacts/import/validate'] },
  { surface: 'contact_metadata', permission: 'view_contacts_metadata', routes: ['GET /api/contacts', 'GET /api/contacts/browser', 'GET /api/contacts/detail', 'GET /api/list-hygiene/plan', 'GET /api/contacts/dedupe-merge-plan'] },
  { surface: 'campaigns', permission: 'manage_campaigns', routes: ['POST /api/campaigns', 'POST /api/campaigns/approve-dry-run', 'POST /api/campaigns/schedule-dry-run', 'POST /api/campaigns/enqueue-dry-run', 'GET /api/campaigns/calendar', 'GET /api/campaigns/calendar/allocation', 'GET /api/campaigns/calendar/drilldown'] },
  { surface: 'templates', permission: 'manage_templates', routes: ['POST /api/templates', 'POST /api/templates/preview'] },
  { surface: 'suppressions', permission: 'manage_suppressions', routes: ['GET /api/suppressions', 'POST /api/suppressions'] },
  { surface: 'data_sources', permission: 'manage_data_sources', routes: ['POST /api/data-sources', 'POST /api/data-source-query/execute', 'POST /api/data-source-schema/discover', 'POST /api/data-source-import/execute', 'POST /api/data-source-import-schedules', 'GET /api/data-source-import-schedules/worker-plan', 'GET /api/data-source-import-schedules/runbook'] },
  { surface: 'reporting', permission: 'view_reporting', routes: ['GET /api/email/reporting', 'GET /api/email/reporting/dashboard', 'GET /api/email/reporting/drilldown', 'GET /api/email/reporting/export', 'GET /api/campaigns/reporting'] },
  { surface: 'sending_readiness', permission: 'review_sending_readiness', routes: ['GET /api/email/sending-readiness', 'GET /api/email/controlled-live-test/readiness', 'POST /api/email/controlled-live-test/plan', 'GET /api/email/controlled-live-test/seed-observation', 'GET /api/send-queue/readiness'] }
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
    plannedRoles: ROLE_MATRIX,
    routePolicy: RBAC_ROUTE_POLICY,
    enforcement: {
      current: 'admin_session_plus_route_permission_policy_for_hardened_surfaces',
      multiUser: 'activation_workflow_available_after_postgresql_user_repository_enablement',
      perRoutePermissions: 'active_for_admin_user_audit_contacts_campaigns_templates_suppressions_data_sources_reporting_readiness',
      invitationFlow: 'safe_plan_only_no_email_token_or_user_mutation',
      auditRoleChanges: 'invite_plans_and_permission_denials_audited'
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
      'operator onboarding runbook for out-of-band invite/reset code delivery',
      'role-change mutation endpoint with audit events',
      'session invalidation on role changes',
      'least-privilege defaults for non-owner users'
    ],
    errors,
    realDeliveryAllowed: false
  };
};
