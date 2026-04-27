const DEFAULT_GLOBAL_LIMIT = 25;
const DEFAULT_DOMAIN_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

const domainFromEmail = (email) => String(email || '').split('@')[1]?.toLowerCase() || '';

const parseLimit = (value, fallback) => {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getRateLimitConfig = (env = process.env) => ({
  windowSeconds: WINDOW_MS / 1000,
  globalPerWindow: parseLimit(env.ORACLESTREET_DRY_RUN_GLOBAL_RATE_LIMIT, DEFAULT_GLOBAL_LIMIT),
  perDomainPerWindow: parseLimit(env.ORACLESTREET_DRY_RUN_DOMAIN_RATE_LIMIT, DEFAULT_DOMAIN_LIMIT),
  warmupMode: env.ORACLESTREET_WARMUP_MODE || 'dry-run-default'
});

export const evaluateRateLimit = ({ queue = [], to, now = new Date(), env = process.env }) => {
  const config = getRateLimitConfig(env);
  const cutoff = now.getTime() - WINDOW_MS;
  const domain = domainFromEmail(to);
  const recent = queue.filter((job) => new Date(job.createdAt).getTime() >= cutoff);
  const recentDomain = recent.filter((job) => domainFromEmail(job.to) === domain);
  const errors = [];

  if (recent.length >= config.globalPerWindow) errors.push('global_rate_limit_exceeded');
  if (recentDomain.length >= config.perDomainPerWindow) errors.push('domain_rate_limit_exceeded');

  return {
    ok: errors.length === 0,
    errors,
    domain,
    config,
    usage: {
      global: recent.length,
      domain: recentDomain.length
    }
  };
};
