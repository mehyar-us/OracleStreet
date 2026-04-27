const parsePositiveInteger = (value, fallback) => {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseWindowSeconds = (value, fallback) => {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed >= 60 && parsed <= 86400 ? parsed : fallback;
};

export const platformRateLimitReadiness = (env = process.env) => {
  const adminWindowSeconds = parseWindowSeconds(env.ORACLESTREET_ADMIN_RATE_LIMIT_WINDOW_SECONDS, 900);
  const adminLoginPerWindow = parsePositiveInteger(env.ORACLESTREET_ADMIN_LOGIN_RATE_LIMIT, 10);
  const apiPerWindow = parsePositiveInteger(env.ORACLESTREET_API_RATE_LIMIT, 120);
  const importPerWindow = parsePositiveInteger(env.ORACLESTREET_IMPORT_RATE_LIMIT, 10);
  const dryRunGlobalPerHour = parsePositiveInteger(env.ORACLESTREET_DRY_RUN_GLOBAL_RATE_LIMIT, 25);
  const dryRunDomainPerHour = parsePositiveInteger(env.ORACLESTREET_DRY_RUN_DOMAIN_RATE_LIMIT, 5);
  const errors = [];

  if (adminLoginPerWindow > apiPerWindow) errors.push('admin_login_limit_must_not_exceed_api_limit');
  if (dryRunDomainPerHour > dryRunGlobalPerHour) errors.push('domain_dry_run_limit_must_not_exceed_global_limit');

  return {
    ok: errors.length === 0,
    mode: 'platform-rate-limit-readiness-safe-gate',
    windows: {
      adminWindowSeconds,
      dryRunWindowSeconds: 3600
    },
    limits: {
      adminLoginPerWindow,
      apiPerWindow,
      importPerWindow,
      dryRunGlobalPerHour,
      dryRunDomainPerHour
    },
    protectedSurfaces: [
      'admin_login',
      'authenticated_api',
      'contact_import',
      'event_import',
      'dry_run_send_queue',
      'campaign_dry_run_enqueue'
    ],
    enforcement: {
      dryRunQueue: 'implemented_per_window',
      adminLogin: 'planned_before_public_signup',
      authenticatedApi: 'planned_before_multi-user_rollout',
      imports: 'planned_before_large_csv_uploads',
      externalDelivery: 'locked'
    },
    safety: {
      noTrafficMutation: true,
      noIpStorageInReadiness: true,
      noSecretOutput: true,
      realDeliveryAllowed: false
    },
    recommendedGates: [
      'keep dry-run queue global and per-domain limits enforced before provider dispatch',
      'add IP/session counters before public admin exposure',
      'rate-limit CSV imports before enabling large uploads',
      'require explicit controlled-live approval before non-dry-run delivery'
    ],
    errors,
    realDeliveryAllowed: false
  };
};
