const cleanHost = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const cleanUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const validTlsModes = ['http-only', 'cloudflare-flexible', 'cloudflare-full', 'origin-certbot'];

const baseWebConfig = (env = process.env) => {
  const primaryDomain = cleanHost(env.ORACLESTREET_PRIMARY_DOMAIN || 'stuffprettygood.com');
  return {
    primaryDomain,
    wwwDomain: cleanHost(env.ORACLESTREET_WWW_DOMAIN || `www.${primaryDomain}`),
    vpsIp: cleanHost(env.ORACLESTREET_VPS_IP || '187.124.147.49'),
    primaryUrl: cleanUrl(env.ORACLESTREET_PRIMARY_URL || `http://${primaryDomain}`),
    fallbackUrl: cleanUrl(env.ORACLESTREET_FALLBACK_URL || `http://${cleanHost(env.ORACLESTREET_VPS_IP || '187.124.147.49')}`),
    tlsMode: String(env.ORACLESTREET_TLS_MODE || 'http-only').trim().toLowerCase()
  };
};

export const webDomainReadiness = (env = process.env) => {
  const { primaryDomain, wwwDomain, vpsIp, primaryUrl, fallbackUrl, tlsMode } = baseWebConfig(env);
  const errors = [];

  if (!primaryDomain) errors.push('primary_domain_required');
  if (!vpsIp) errors.push('vps_ip_required');
  if (!validTlsModes.includes(tlsMode)) errors.push('valid_tls_mode_required');

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

export const webTlsReadiness = (env = process.env) => {
  const { primaryDomain, wwwDomain, vpsIp, tlsMode } = baseWebConfig(env);
  const errors = [];
  if (!primaryDomain) errors.push('primary_domain_required');
  if (!vpsIp) errors.push('vps_ip_required');
  if (!validTlsModes.includes(tlsMode)) errors.push('valid_tls_mode_required');

  const candidateDomains = [primaryDomain, wwwDomain].filter(Boolean);
  const originCertbotSelected = tlsMode === 'origin-certbot';
  const cloudflareFullSelected = tlsMode === 'cloudflare-full';
  const httpsPlanned = originCertbotSelected || cloudflareFullSelected;

  return {
    ok: errors.length === 0,
    mode: 'web-tls-readiness-safe-gate',
    primaryDomain: primaryDomain || null,
    wwwDomain: wwwDomain || null,
    vpsIp: vpsIp || null,
    tlsMode,
    certificate: {
      requiredBeforeSensitiveProductionUse: true,
      originCertbotSelected,
      cloudflareFullSelected,
      candidateDomains,
      challengeType: originCertbotSelected ? 'http-01' : 'not-selected',
      certificateProbe: 'skipped_safe_default',
      installation: 'not_automated_by_readiness_endpoint'
    },
    prerequisites: {
      dnsStable: true,
      nginxConfigValidRequired: true,
      port80ReachableRequired: true,
      port443RequiredBeforeHttps: true,
      fallbackHttpSmokeRequired: true
    },
    recommendedNextSteps: originCertbotSelected ? [
      `confirm A records for ${candidateDomains.join(', ')} point to ${vpsIp}`,
      'run nginx config test before requesting certificates',
      'request/renew origin certificate with certbot only after DNS and port 80 smoke tests pass',
      'reload nginx and run HTTPS health smoke tests'
    ] : [
      'keep HTTP smoke tests passing while product remains in safe-test mode',
      'choose cloudflare-full or origin-certbot before handling sensitive production traffic',
      'do not unlock real email delivery from TLS status alone'
    ],
    smokeTests: {
      http: [`curl -I http://${primaryDomain}/`, `curl http://${primaryDomain}/api/health`],
      https: httpsPlanned ? [`curl -I https://${primaryDomain}/`, `curl https://${primaryDomain}/api/health`] : []
    },
    httpsPlanned,
    errors,
    realDeliveryAllowed: false
  };
};
