const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getEmailProviderConfig = (env = process.env) => {
  const provider = String(env.ORACLESTREET_MAIL_PROVIDER || 'dry-run').trim().toLowerCase();
  const realSendingEnabled = env.ORACLESTREET_REAL_EMAIL_ENABLED === 'true';
  const powerMtaConfigured = Boolean(env.ORACLESTREET_POWERMTA_HOST);

  return {
    provider,
    sendMode: realSendingEnabled ? 'controlled-live-test-only' : 'safe-test-only',
    realSendingEnabled,
    powerMtaConfigured,
    powerMta: {
      hostConfigured: Boolean(env.ORACLESTREET_POWERMTA_HOST),
      port: Number(env.ORACLESTREET_POWERMTA_PORT || 587),
      usernameConfigured: Boolean(env.ORACLESTREET_POWERMTA_USERNAME),
      passwordConfigured: Boolean(env.ORACLESTREET_POWERMTA_PASSWORD),
      secure: env.ORACLESTREET_POWERMTA_SECURE === 'true'
    },
    defaultFrom: {
      emailConfigured: Boolean(env.ORACLESTREET_DEFAULT_FROM_EMAIL),
      name: env.ORACLESTREET_DEFAULT_FROM_NAME || 'OracleStreet'
    }
  };
};

export const validatePowerMtaConfig = (env = process.env) => {
  const errors = [];
  if (!env.ORACLESTREET_POWERMTA_HOST) errors.push('powermta_host_required');
  const port = Number(env.ORACLESTREET_POWERMTA_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('valid_powermta_port_required');
  if (!env.ORACLESTREET_POWERMTA_USERNAME) errors.push('powermta_username_required');
  if (!env.ORACLESTREET_POWERMTA_PASSWORD) errors.push('powermta_password_required');
  if (!env.ORACLESTREET_DEFAULT_FROM_EMAIL || !EMAIL_RE.test(env.ORACLESTREET_DEFAULT_FROM_EMAIL)) errors.push('valid_default_from_email_required');
  return { ok: errors.length === 0, errors };
};

export const validateTestMessage = (message = {}) => {
  const errors = [];
  const to = String(message.to || '').trim().toLowerCase();
  const subject = String(message.subject || '').trim();
  const html = String(message.html || '').trim();
  const consentStatus = String(message.consentStatus || '').trim();
  const source = String(message.source || '').trim();

  if (!EMAIL_RE.test(to)) errors.push('valid_to_email_required');
  if (!subject) errors.push('subject_required');
  if (!html) errors.push('html_required');
  if (!['opt_in', 'double_opt_in'].includes(consentStatus)) errors.push('explicit_consent_required');
  if (!source) errors.push('source_required');
  if (!/unsubscribe/i.test(html)) errors.push('unsubscribe_link_required');

  return {
    ok: errors.length === 0,
    errors,
    normalized: { to, subject, html, consentStatus, source }
  };
};

export const dryRunSend = (message, env = process.env) => {
  const validation = validateTestMessage(message);
  if (!validation.ok) return { ok: false, mode: 'dry-run', errors: validation.errors };

  const providerConfig = getEmailProviderConfig(env);
  if (providerConfig.provider === 'powermta') {
    const powerMta = validatePowerMtaConfig(env);
    if (!powerMta.ok) {
      return { ok: false, mode: 'dry-run', provider: 'powermta', errors: powerMta.errors };
    }
  }

  return {
    ok: true,
    mode: 'dry-run',
    provider: providerConfig.provider,
    providerMessageId: `dryrun_${Date.now().toString(36)}`,
    accepted: {
      to: validation.normalized.to,
      subject: validation.normalized.subject,
      source: validation.normalized.source
    },
    realDelivery: false
  };
};
