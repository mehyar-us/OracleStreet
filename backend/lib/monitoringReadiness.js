const cleanUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const cleanInterval = (value) => Number(value || 300);

export const monitoringReadiness = (env = process.env) => {
  const primaryUrl = cleanUrl(env.ORACLESTREET_PRIMARY_URL || 'http://stuffprettygood.com');
  const fallbackUrl = cleanUrl(env.ORACLESTREET_FALLBACK_URL || 'http://187.124.147.49');
  const intervalSeconds = cleanInterval(env.ORACLESTREET_MONITOR_INTERVAL_SECONDS || 300);
  const alertTargetConfigured = Boolean(String(env.ORACLESTREET_MONITOR_ALERT_TARGET || '').trim());
  const errors = [];

  if (!primaryUrl) errors.push('primary_url_required');
  if (!fallbackUrl) errors.push('fallback_url_required');
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 86400) errors.push('valid_monitor_interval_seconds_required');

  return {
    ok: errors.length === 0,
    mode: 'monitoring-readiness-safe-gate',
    endpoints: {
      primaryHealth: primaryUrl ? `${primaryUrl}/api/health` : null,
      primaryFrontend: primaryUrl ? `${primaryUrl}/` : null,
      fallbackHealth: fallbackUrl ? `${fallbackUrl}/api/health` : null,
      fallbackFrontend: fallbackUrl ? `${fallbackUrl}/` : null,
      endpointProbe: 'skipped_readiness_only'
    },
    services: {
      backend: 'oraclestreet-backend',
      watchdogTimer: 'oraclestreet-watchdog.timer',
      nginxConfig: 'nginx -t',
      dockerStatus: 'docker ps',
      serviceProbe: 'skipped_readiness_only'
    },
    schedule: {
      intervalSeconds,
      systemdTimerCandidate: 'oraclestreet-monitor.timer',
      watchdogAlreadyExpected: true
    },
    alerts: {
      targetConfigured: alertTargetConfigured,
      recommendedEvents: ['health_check_failed', 'frontend_unreachable', 'backend_inactive', 'nginx_config_invalid', 'watchdog_timer_inactive'],
      secretOutputAllowed: false
    },
    safety: {
      noNetworkProbe: true,
      noServiceMutation: true,
      noSecretOutput: true,
      realDeliveryAllowed: false
    },
    recommendedCommands: [
      `curl --fail --max-time 10 ${primaryUrl || 'http://<domain>'}/api/health`,
      `curl --fail --head --max-time 10 ${primaryUrl || 'http://<domain>'}/`,
      'systemctl is-active oraclestreet-backend',
      'systemctl is-active oraclestreet-watchdog.timer',
      'nginx -t'
    ],
    errors,
    realDeliveryAllowed: false
  };
};
