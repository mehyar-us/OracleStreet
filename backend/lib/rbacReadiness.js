import { listAdminUsers, permissionsForRole, ROLE_MATRIX } from './adminUsers.js';

const cleanEmail = (value) => String(value || '').trim().toLowerCase();

export const RBAC_ROUTE_POLICY = [
  { surface: 'admin_users', permission: 'manage_users', routes: ['GET /api/admin/users', 'GET /api/admin/sessions', 'POST /api/admin/sessions/revoke-user', 'GET /api/platform/rbac-effective-access', 'GET /api/platform/rbac-role-change-preview', 'POST /api/admin/users/invite-plan', 'POST /api/admin/users/invite', 'POST /api/admin/users/password-reset-plan'] },
  { surface: 'audit_log', permission: 'view_audit_log', routes: ['GET /api/audit-log'] },
  { surface: 'contacts', permission: 'manage_contacts', routes: ['POST /api/contacts/import', 'POST /api/contacts/import/validate'] },
  { surface: 'contact_metadata', permission: 'view_contacts_metadata', routes: ['GET /api/contacts', 'GET /api/contacts/browser', 'GET /api/contacts/browser/export-preview', 'GET /api/contacts/campaign-fit-plan', 'GET /api/contacts/campaign-handoff-preview', 'GET /api/contacts/consent-provenance-review', 'GET /api/contacts/detail', 'GET /api/contacts/domain-risk-plan', 'GET /api/contacts/engagement-recency-plan', 'GET /api/contacts/source-detail-review', 'GET /api/contacts/source-quality', 'GET /api/contacts/source-hygiene-plan', 'GET /api/contacts/source-quarantine-plan', 'GET /api/contacts/source-quality-matrix', 'GET /api/contacts/risk-triage', 'GET /api/contacts/repermission-plan', 'GET /api/contacts/suppression-review', 'GET /api/contacts/audience-exclusion-preview', 'GET /api/contacts/audience-readiness', 'GET /api/list-hygiene/plan', 'GET /api/contacts/dedupe-merge-plan'] },
  { surface: 'campaigns', permission: 'manage_campaigns', routes: ['POST /api/campaigns', 'POST /api/campaigns/approve-dry-run', 'POST /api/campaigns/schedule-dry-run', 'POST /api/campaigns/enqueue-dry-run', 'GET /api/campaigns/calendar', 'GET /api/campaigns/calendar/allocation', 'GET /api/campaigns/calendar/drilldown', 'GET /api/campaigns/calendar/reschedule-plan', 'GET /api/campaigns/calendar/capacity-forecast', 'GET /api/campaigns/calendar/launch-readiness', 'GET /api/campaigns/calendar/operator-actions', 'GET /api/campaigns/calendar/warmup-board'] },
  { surface: 'templates', permission: 'manage_templates', routes: ['POST /api/templates', 'POST /api/templates/preview'] },
  { surface: 'suppressions', permission: 'manage_suppressions', routes: ['GET /api/suppressions', 'POST /api/suppressions'] },
  { surface: 'data_sources', permission: 'manage_data_sources', routes: ['POST /api/data-sources', 'POST /api/data-source-query/execute', 'POST /api/data-source-schema/discover', 'POST /api/data-source-import/execute', 'POST /api/data-source-import-schedules', 'POST /api/data-source-import-schedules/status', 'GET /api/data-source-import-schedules/preflight', 'GET /api/data-source-import-schedules/worker-plan', 'GET /api/data-source-import-schedules/timeline', 'GET /api/data-source-import-schedules/runbook', 'GET /api/data-source-import-schedules/audit'] },
  { surface: 'reporting', permission: 'view_reporting', routes: ['GET /api/email/reporting', 'GET /api/email/reporting/dashboard', 'GET /api/email/reporting/drilldown', 'GET /api/email/reporting/deliverability-audit', 'GET /api/email/reporting/export', 'GET /api/campaigns/reporting'] },
  { surface: 'sending_readiness', permission: 'review_sending_readiness', routes: ['GET /api/email/sending-readiness', 'GET /api/email/mta-operations', 'GET /api/email/provider/readiness-drilldown', 'GET /api/email/controlled-live-test/readiness', 'POST /api/email/controlled-live-test/plan', 'GET /api/email/controlled-live-test/seed-observation', 'GET /api/email/controlled-live-test/proof-packet', 'GET /api/send-queue/readiness'] }
];

export const rbacEffectiveAccess = ({ currentEmail = null, currentRole = 'admin' } = {}) => {
  const directory = listAdminUsers();
  const routePermissions = [...new Set(RBAC_ROUTE_POLICY.map((policy) => policy.permission))];
  const users = (directory.users || []).map((user) => {
    const permissions = permissionsForRole(user.role);
    const allowedSurfaces = RBAC_ROUTE_POLICY
      .filter((policy) => permissions.includes(policy.permission))
      .map((policy) => ({ surface: policy.surface, permission: policy.permission, routeCount: policy.routes.length }));
    const blockedSurfaces = RBAC_ROUTE_POLICY
      .filter((policy) => !permissions.includes(policy.permission))
      .map((policy) => ({ surface: policy.surface, requiredPermission: policy.permission }));
    return {
      email: user.email,
      role: user.role,
      status: user.status,
      permissionCount: permissions.length,
      permissions,
      allowedSurfaceCount: allowedSurfaces.length,
      blockedSurfaceCount: blockedSurfaces.length,
      allowedSurfaces,
      blockedSurfaces,
      passwordConfigured: Boolean(user.hasPassword),
      invitePending: Boolean(user.invitePending),
      resetPending: Boolean(user.resetPending)
    };
  });
  const roleCoverage = ROLE_MATRIX.map((role) => {
    const permissions = permissionsForRole(role.role);
    const coveredSurfaces = RBAC_ROUTE_POLICY.filter((policy) => permissions.includes(policy.permission));
    const missingPermissions = routePermissions.filter((permission) => !permissions.includes(permission));
    return {
      role: role.role,
      permissions,
      routeSurfacesAllowed: coveredSurfaces.length,
      routesAllowed: coveredSurfaces.reduce((total, policy) => total + policy.routes.length, 0),
      missingPermissions,
      leastPrivilege: role.role !== 'owner' && role.role !== 'admin'
    };
  });
  const currentPermissions = permissionsForRole(currentRole);
  return {
    ok: true,
    mode: 'rbac-effective-access-review',
    currentUser: {
      email: String(currentEmail || '').trim().toLowerCase(),
      role: currentRole,
      permissions: currentPermissions,
      allowedSurfaces: RBAC_ROUTE_POLICY.filter((policy) => currentPermissions.includes(policy.permission)).map((policy) => policy.surface)
    },
    totals: {
      usersReviewed: users.length,
      rolesReviewed: ROLE_MATRIX.length,
      routeSurfaces: RBAC_ROUTE_POLICY.length,
      uniqueRoutePermissions: routePermissions.length,
      usersWithPendingInvites: users.filter((user) => user.invitePending).length,
      usersWithPendingResets: users.filter((user) => user.resetPending).length
    },
    users,
    roleCoverage,
    routePolicy: RBAC_ROUTE_POLICY,
    recommendations: [
      users.some((user) => user.role === 'owner') ? 'owner_role_present_for_owner_only_escalations' : 'create_owner_role_before_multi_user_unlock',
      users.filter((user) => ['owner', 'admin'].includes(user.role)).length >= 2 ? 'manage_users_redundancy_present' : 'add_second_manage_users_admin_before_disabling_bootstrap_access',
      users.some((user) => user.invitePending) ? 'clear_or_accept_pending_invites_before_access_audit_signoff' : 'no_pending_invite_cleanup_needed'
    ],
    safety: {
      adminOnly: true,
      readOnly: true,
      noUserMutation: true,
      noRoleMutation: true,
      noPasswordOutput: true,
      noTokenOutput: true,
      noEmailSent: true,
      noDeliveryUnlock: true,
      realDeliveryAllowed: false
    },
    persistenceMode: directory.persistenceMode,
    realDeliveryAllowed: false
  };
};

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
      'session invalidation on role changes (shipped: target sessions are revoked after successful role updates)',
      'least-privilege defaults for non-owner users'
    ],
    errors,
    realDeliveryAllowed: false
  };
};


export const rbacRoleChangeImpactPreview = ({ email = '', targetRole = '', requestedBy = null, requesterRole = 'admin' } = {}) => {
  const cleanTargetEmail = cleanEmail(email);
  const cleanTargetRole = String(targetRole || '').trim().toLowerCase();
  const requesterEmail = cleanEmail(requestedBy);
  const directory = listAdminUsers();
  const target = (directory.users || []).find((user) => cleanEmail(user.email) === cleanTargetEmail) || null;
  const allowedRoles = new Set(ROLE_MATRIX.map((entry) => entry.role));
  const errors = [];
  if (!cleanTargetEmail || !cleanTargetEmail.includes('@')) errors.push('valid_user_email_required');
  if (!allowedRoles.has(cleanTargetRole)) errors.push('valid_role_required');
  if (!target && cleanTargetEmail) errors.push('user_not_found');
  if (cleanTargetRole === 'owner' && requesterRole !== 'owner') errors.push('owner_role_requires_owner_requester');
  if (target?.role === 'owner' && cleanTargetRole !== 'owner' && requesterRole !== 'owner') errors.push('owner_demotion_requires_owner_requester');
  const currentPermissions = permissionsForRole(target?.role);
  const targetPermissions = permissionsForRole(cleanTargetRole);
  if (requesterEmail && cleanTargetEmail === requesterEmail && currentPermissions.includes('manage_users') && !targetPermissions.includes('manage_users')) errors.push('self_demotion_would_remove_manage_users');
  const currentPrivileged = (directory.users || []).filter((user) => permissionsForRole(user.role).includes('manage_users') && user.status !== 'disabled');
  if (target && currentPermissions.includes('manage_users') && !targetPermissions.includes('manage_users') && currentPrivileged.length <= 1) errors.push('last_manage_users_admin_cannot_be_demoted');
  const currentSurfaces = RBAC_ROUTE_POLICY.filter((policy) => currentPermissions.includes(policy.permission)).map((policy) => policy.surface);
  const targetSurfaces = RBAC_ROUTE_POLICY.filter((policy) => targetPermissions.includes(policy.permission)).map((policy) => policy.surface);
  const addedPermissions = targetPermissions.filter((permission) => !currentPermissions.includes(permission));
  const removedPermissions = currentPermissions.filter((permission) => !targetPermissions.includes(permission));
  const addedSurfaces = targetSurfaces.filter((surface) => !currentSurfaces.includes(surface));
  const removedSurfaces = currentSurfaces.filter((surface) => !targetSurfaces.includes(surface));
  const requiresSessionRevocation = Boolean(target && target.role !== cleanTargetRole);
  return {
    ok: errors.length === 0,
    mode: 'rbac-role-change-impact-preview',
    targetUser: target ? { email: target.email, currentRole: target.role, status: target.status, targetRole: cleanTargetRole } : { email: cleanTargetEmail, currentRole: null, status: null, targetRole: cleanTargetRole },
    impact: {
      addedPermissions,
      removedPermissions,
      addedSurfaces,
      removedSurfaces,
      currentAllowedSurfaceCount: currentSurfaces.length,
      targetAllowedSurfaceCount: targetSurfaces.length,
      requiresSessionRevocation,
      wouldMutateRole: false,
      wouldRevokeSessionsIfApplied: requiresSessionRevocation
    },
    guardrails: [
      { key: 'target_user_exists', passed: Boolean(target) },
      { key: 'target_role_valid', passed: allowedRoles.has(cleanTargetRole) },
      { key: 'owner_escalation_guard', passed: !(cleanTargetRole === 'owner' && requesterRole !== 'owner') },
      { key: 'self_demotion_guard', passed: !errors.includes('self_demotion_would_remove_manage_users') },
      { key: 'last_manage_users_admin_guard', passed: !errors.includes('last_manage_users_admin_cannot_be_demoted') },
      { key: 'session_revocation_after_apply', passed: true, note: requiresSessionRevocation ? 'target_sessions_would_be_revoked_after_successful_role_update' : 'no_role_change_no_session_revocation_needed' }
    ],
    recommendations: errors.length
      ? ['fix_role_change_guardrail_errors_before_applying_role_update']
      : requiresSessionRevocation
        ? ['apply_only_after_operator_review_then_require_target_user_fresh_login']
        : ['no_effective_role_change_detected'],
    errors,
    safety: {
      adminOnly: true,
      readOnly: true,
      previewOnly: true,
      noUserMutation: true,
      noRoleMutation: true,
      noSessionMutation: true,
      noPasswordOutput: true,
      noTokenOutput: true,
      noEmailSent: true,
      noDeliveryUnlock: true,
      realDeliveryAllowed: false
    },
    persistenceMode: directory.persistenceMode,
    realDeliveryAllowed: false
  };
};
