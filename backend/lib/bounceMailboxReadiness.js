const redactMailboxUser = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const [local, domain] = raw.split('@');
  if (!domain) return raw.length <= 3 ? 'configured' : `${raw.slice(0, 2)}***`;
  return `${local.slice(0, 2)}***@${domain}`;
};

const boolFromEnv = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

export const bounceMailboxReadiness = (env = process.env) => {
  const host = String(env.ORACLESTREET_BOUNCE_MAILBOX_HOST || '').trim();
  const port = Number.parseInt(env.ORACLESTREET_BOUNCE_MAILBOX_PORT || '993', 10);
  const username = String(env.ORACLESTREET_BOUNCE_MAILBOX_USERNAME || '').trim();
  const passwordConfigured = Boolean(String(env.ORACLESTREET_BOUNCE_MAILBOX_PASSWORD || '').trim());
  const folder = String(env.ORACLESTREET_BOUNCE_MAILBOX_FOLDER || 'INBOX').trim();
  const secure = String(env.ORACLESTREET_BOUNCE_MAILBOX_SECURE || 'true').trim().toLowerCase() !== 'false';
  const pollEnabled = boolFromEnv(env.ORACLESTREET_BOUNCE_MAILBOX_POLL_ENABLED);
  const errors = [];

  if (!host) errors.push('bounce_mailbox_host_required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('valid_bounce_mailbox_port_required');
  if (!username) errors.push('bounce_mailbox_username_required');
  if (!passwordConfigured) errors.push('bounce_mailbox_password_required');
  if (!folder) errors.push('bounce_mailbox_folder_required');
  if (pollEnabled) errors.push('bounce_mailbox_polling_must_remain_disabled_until_controlled_approval');

  return {
    ok: errors.length === 0,
    mode: 'bounce-mailbox-readiness-safe-gate',
    mailbox: {
      hostConfigured: Boolean(host),
      port: Number.isInteger(port) ? port : null,
      username: redactMailboxUser(username),
      passwordConfigured,
      folder: folder || null,
      secure,
      pollEnabled
    },
    parser: {
      validateEndpoint: '/api/email/bounce-parse/validate',
      ingestEndpoint: '/api/email/bounce-parse/ingest',
      hardBounceSuppression: true,
      deferralSuppression: false
    },
    blockers: errors,
    nextSafeStep: errors.length > 0
      ? 'configure_bounce_mailbox_env_then_validate_without_network_probe'
      : 'run_owned_mailbox_fixture_parse_before_any_polling_approval',
    safety: {
      noNetworkProbe: true,
      noMailboxConnection: true,
      noMessageRead: true,
      noSecretOutput: true,
      noSuppressionCreated: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};
