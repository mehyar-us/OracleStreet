const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDERS = new Set(['dry-run', 'local-capture', 'smtp', 'powermta']);

const localCapture = [];
let localCaptureSequence = 0;

const redact = (value) => Boolean(value);
const provider = (env = process.env) => String(env.ORACLESTREET_MAIL_PROVIDER || 'dry-run').trim().toLowerCase();
const parsePort = (value, fallback) => Number(value || fallback);
const captureAllowedDomain = (env = process.env) => String(env.ORACLESTREET_LOCAL_CAPTURE_ALLOWED_DOMAIN || 'example.test').trim().toLowerCase();

export const resetLocalCaptureForTests = () => {
  localCapture.length = 0;
  localCaptureSequence = 0;
};

export const listLocalCapture = () => ({
  ok: true,
  mode: 'local-capture',
  count: localCapture.length,
  messages: localCapture.map((message) => ({ ...message }))
});

export const getEmailProviderConfig = (env = process.env) => {
  const selectedProvider = provider(env);
  const realSendingEnabled = env.ORACLESTREET_REAL_EMAIL_ENABLED === 'true';

  return {
    provider: selectedProvider,
    supportedProviders: [...PROVIDERS],
    sendMode: realSendingEnabled ? 'controlled-live-test-only' : 'safe-test-only',
    realSendingEnabled,
    powerMtaConfigured: Boolean(env.ORACLESTREET_POWERMTA_HOST),
    smtpConfigured: Boolean(env.ORACLESTREET_SMTP_HOST),
    localCapture: {
      allowedDomain: captureAllowedDomain(env),
      externalDelivery: false
    },
    powerMta: {
      hostConfigured: redact(env.ORACLESTREET_POWERMTA_HOST),
      port: parsePort(env.ORACLESTREET_POWERMTA_PORT, 587),
      usernameConfigured: redact(env.ORACLESTREET_POWERMTA_USERNAME),
      passwordConfigured: redact(env.ORACLESTREET_POWERMTA_PASSWORD),
      secure: env.ORACLESTREET_POWERMTA_SECURE === 'true'
    },
    smtp: {
      hostConfigured: redact(env.ORACLESTREET_SMTP_HOST),
      port: parsePort(env.ORACLESTREET_SMTP_PORT, 587),
      usernameConfigured: redact(env.ORACLESTREET_SMTP_USERNAME),
      passwordConfigured: redact(env.ORACLESTREET_SMTP_PASSWORD),
      secure: env.ORACLESTREET_SMTP_SECURE === 'true'
    },
    defaultFrom: {
      emailConfigured: redact(env.ORACLESTREET_DEFAULT_FROM_EMAIL),
      name: env.ORACLESTREET_DEFAULT_FROM_NAME || 'OracleStreet'
    }
  };
};

const validateSmtpLikeConfig = ({ prefix, label, env = process.env }) => {
  const errors = [];
  const host = env[`${prefix}_HOST`];
  const port = parsePort(env[`${prefix}_PORT`], 587);
  const username = env[`${prefix}_USERNAME`];
  const password = env[`${prefix}_PASSWORD`];
  const secure = env[`${prefix}_SECURE`] === 'true';

  if (!host) errors.push(`${label}_host_required`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(`valid_${label}_port_required`);
  if (!username) errors.push(`${label}_username_required`);
  if (!password) errors.push(`${label}_password_required`);
  if (!env.ORACLESTREET_DEFAULT_FROM_EMAIL || !EMAIL_RE.test(env.ORACLESTREET_DEFAULT_FROM_EMAIL)) errors.push('valid_default_from_email_required');

  return {
    ok: errors.length === 0,
    provider: label === 'powermta' ? 'powermta' : 'smtp',
    errors,
    checks: {
      hostConfigured: redact(host),
      portValid: Number.isInteger(port) && port >= 1 && port <= 65535,
      authConfigured: redact(username) && redact(password),
      defaultFromConfigured: Boolean(env.ORACLESTREET_DEFAULT_FROM_EMAIL && EMAIL_RE.test(env.ORACLESTREET_DEFAULT_FROM_EMAIL)),
      secure,
      networkProbe: 'skipped_safe_default'
    }
  };
};

export const validatePowerMtaConfig = (env = process.env) => validateSmtpLikeConfig({
  prefix: 'ORACLESTREET_POWERMTA',
  label: 'powermta',
  env
});

export const validateSmtpConfig = (env = process.env) => validateSmtpLikeConfig({
  prefix: 'ORACLESTREET_SMTP',
  label: 'smtp',
  env
});

export const validateSelectedProviderConfig = (env = process.env) => {
  const selectedProvider = provider(env);
  if (!PROVIDERS.has(selectedProvider)) {
    return { ok: false, provider: selectedProvider, errors: ['unsupported_mail_provider'], checks: { networkProbe: 'skipped_safe_default' } };
  }
  if (selectedProvider === 'dry-run') {
    return { ok: true, provider: 'dry-run', errors: [], checks: { realDelivery: false, networkProbe: 'not_applicable' } };
  }
  if (selectedProvider === 'local-capture') {
    const allowedDomain = captureAllowedDomain(env);
    return {
      ok: Boolean(allowedDomain && allowedDomain.includes('.')),
      provider: 'local-capture',
      errors: allowedDomain && allowedDomain.includes('.') ? [] : ['valid_local_capture_allowed_domain_required'],
      checks: {
        allowedDomain,
        externalDelivery: false,
        networkProbe: 'not_applicable'
      }
    };
  }
  if (selectedProvider === 'smtp') return validateSmtpConfig(env);
  return validatePowerMtaConfig(env);
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
  if (providerConfig.provider !== 'dry-run') {
    const providerValidation = validateSelectedProviderConfig(env);
    if (!providerValidation.ok) {
      return { ok: false, mode: 'dry-run', provider: providerConfig.provider, errors: providerValidation.errors };
    }
    if (providerConfig.provider === 'local-capture') {
      const allowedDomain = captureAllowedDomain(env);
      const domain = validation.normalized.to.split('@')[1];
      if (domain !== allowedDomain) {
        return { ok: false, mode: 'dry-run', provider: 'local-capture', errors: ['recipient_outside_local_capture_domain'], captureAllowedDomain: allowedDomain };
      }
    }
  }

  const providerMessageId = `${providerConfig.provider === 'local-capture' ? 'capture' : 'dryrun'}_${Date.now().toString(36)}`;
  if (providerConfig.provider === 'local-capture') {
    localCapture.push({
      id: `cap_${(++localCaptureSequence).toString().padStart(6, '0')}`,
      providerMessageId,
      to: validation.normalized.to,
      subject: validation.normalized.subject,
      source: validation.normalized.source,
      externalDelivery: false,
      createdAt: new Date().toISOString()
    });
  }

  return {
    ok: true,
    mode: 'dry-run',
    provider: providerConfig.provider,
    providerMessageId,
    accepted: {
      to: validation.normalized.to,
      subject: validation.normalized.subject,
      source: validation.normalized.source
    },
    realDelivery: false
  };
};
