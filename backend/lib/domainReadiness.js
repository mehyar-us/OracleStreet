const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

const cleanDomain = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const defaultFromEmail = (env = process.env) => String(env.ORACLESTREET_DEFAULT_FROM_EMAIL || '').trim().toLowerCase();

export const senderDomainReadiness = (env = process.env) => {
  const email = defaultFromEmail(env);
  const match = email.match(EMAIL_RE);
  const senderDomain = match ? match[1] : null;
  const webDomain = cleanDomain(env.ORACLESTREET_PRIMARY_DOMAIN || 'stuffprettygood.com');
  const errors = [];

  if (!match) errors.push('valid_default_from_email_required');
  if (!webDomain) errors.push('primary_domain_required');

  return {
    ok: errors.length === 0,
    mode: 'sender-domain-readiness-safe-gate',
    senderDomain,
    primaryDomain: webDomain || null,
    checks: {
      defaultFromConfigured: Boolean(match),
      senderDomainMatchesPrimary: Boolean(senderDomain && webDomain && senderDomain === webDomain),
      spfDocumented: true,
      dkimDocumented: true,
      dmarcDocumented: true,
      tlsRequiredBeforeRealSend: true,
      dnsNetworkProbe: 'skipped_safe_default'
    },
    expectedDns: senderDomain ? {
      spf: `TXT ${senderDomain} includes authorized SMTP/PowerMTA sender`,
      dkim: `TXT <selector>._domainkey.${senderDomain} contains DKIM public key`,
      dmarc: `TXT _dmarc.${senderDomain} contains DMARC policy`
    } : null,
    errors,
    realDeliveryAllowed: false
  };
};
