const cleanHost = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const cleanUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

export const webDomainReadiness = (env = process.env) => {
  const primaryDomain = cleanHost(env.ORACLESTREET_PRIMARY_DOMAIN || 'stuffprettygood.com');
  const wwwDomain = cleanHost(env.ORACLESTREET_WWW_DOMAIN || `www.${primaryDomain}`);
  const vpsIp = cleanHost(env.ORACLESTREET_VPS_IP || '187.124.147.49');
  const primaryUrl = cleanUrl(env.ORACLESTREET_PRIMARY_URL || `http://${primaryDomain}`);
  const fallbackUrl = cleanUrl(env.ORACLESTREET_FALLBACK_URL || `http://${vpsIp}`);
  const tlsMode = String(env.ORACLESTREET_TLS_MODE || 'http-only').trim().toLowerCase();
  const errors = [];

  if (!primaryDomain) errors.push('primary_domain_required');
  if (!vpsIp) errors.push('vps_ip_required');
  if (!['http-only', 'cloudflare-flexible', 'cloudflare-full', 'origin-certbot'].includes(tlsMode)) errors.push('valid_tls_mode_required');

  const httpsExpected = ['cloudflare-full', 'origin-certbot'].includes(tlsMode);

  return {
    ok: errors.length === 0,
    mode: 'web-domain-readiness-safe-gate',
    primaryDomain: primaryDomain || null,
    wwwDomain: wwwDomain || null,
    vpsIp: vpsIp || null,
    urls: {
      primary: primaryUrl || null,
      primaryHealth: primaryUrl ? `${primaryUrl}/api/health` : null,
      fallback: fallbackUrl || null,
      fallbackHealth: fallbackUrl ? `${fallbackUrl}/api/health` : null
    },
    dns: {
      expectedApexA: primaryDomain && vpsIp ? `A ${primaryDomain} ${vpsIp}` : null,
      expectedWwwA: wwwDomain && vpsIp ? `A ${wwwDomain} ${vpsIp}` : null,
      networkProbe: 'skipped_use_deployment_smoke_tests'
    },
    tls: {
      mode: tlsMode,
      httpsExpected,
      certificateRequiredBeforeSensitiveProductionUse: true,
      certbotCandidateDomains: [primaryDomain, wwwDomain].filter(Boolean),
      cloudflareProxyAllowed: true,
      realSendingUnlockedByTls: false
    },
    smokeTests: [
      `curl -I ${primaryUrl || 'http://<domain>'}/`,
      `curl ${primaryUrl || 'http://<domain>'}/api/health`,
      `curl -I ${fallbackUrl || 'http://<ip>'}/`,
      `curl ${fallbackUrl || 'http://<ip>'}/api/health`
    ],
    errors,
    realDeliveryAllowed: false
  };
};
