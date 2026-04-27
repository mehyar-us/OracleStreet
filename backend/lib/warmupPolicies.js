const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;
const DEFAULT_POLICY = {
  domain: 'stuffprettygood.com',
  startDate: new Date().toISOString().slice(0, 10),
  startDailyCap: 25,
  maxDailyCap: 500,
  rampPercent: 25,
  days: 14,
  perDomainAllocation: 'single-domain',
  enforcementMode: 'dry-run-schedule-gate'
};

const policies = new Map([[DEFAULT_POLICY.domain, { ...DEFAULT_POLICY }]]);

const normalizeDomain = (domain) => String(domain || '').trim().toLowerCase();
const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const dateOnly = (value) => {
  const parsed = value ? new Date(String(value)) : new Date();
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};
const daysBetween = (leftDate, rightDate) => Math.floor((new Date(`${leftDate}T00:00:00.000Z`).getTime() - new Date(`${rightDate}T00:00:00.000Z`).getTime()) / 86400000);

export const resetWarmupPoliciesForTests = () => {
  policies.clear();
  policies.set(DEFAULT_POLICY.domain, { ...DEFAULT_POLICY, startDate: new Date().toISOString().slice(0, 10) });
};

export const listWarmupPolicies = () => ({
  ok: true,
  mode: 'warmup-policy-registry',
  count: policies.size,
  policies: [...policies.values()].map((policy) => ({ ...policy })),
  persistenceMode: 'in-memory-until-postgresql-warmup-policy-table-enabled',
  realDeliveryAllowed: false
});

export const saveWarmupPolicy = (incoming = {}) => {
  const domain = normalizeDomain(incoming.domain || DEFAULT_POLICY.domain);
  const startDate = dateOnly(incoming.startDate || DEFAULT_POLICY.startDate);
  const policy = {
    domain,
    startDate,
    startDailyCap: parsePositiveInt(incoming.startDailyCap, DEFAULT_POLICY.startDailyCap),
    maxDailyCap: parsePositiveInt(incoming.maxDailyCap, DEFAULT_POLICY.maxDailyCap),
    rampPercent: parsePositiveInt(incoming.rampPercent, DEFAULT_POLICY.rampPercent),
    days: parsePositiveInt(incoming.days, DEFAULT_POLICY.days),
    perDomainAllocation: 'single-domain',
    enforcementMode: 'dry-run-schedule-gate'
  };
  const errors = [];
  if (!DOMAIN_RE.test(policy.domain)) errors.push('valid_sender_domain_required');
  if (!policy.startDate) errors.push('valid_start_date_required');
  if (policy.startDailyCap < 1 || policy.startDailyCap > 10000) errors.push('valid_start_daily_cap_required');
  if (policy.maxDailyCap < policy.startDailyCap || policy.maxDailyCap > 100000) errors.push('valid_max_daily_cap_required');
  if (policy.rampPercent < 1 || policy.rampPercent > 100) errors.push('valid_ramp_percent_1_100_required');
  if (policy.days < 1 || policy.days > 365) errors.push('valid_days_1_365_required');
  if (errors.length > 0) return { ok: false, errors, realDeliveryAllowed: false };

  policies.set(policy.domain, policy);
  return {
    ok: true,
    mode: 'warmup-policy-saved',
    policy: { ...policy },
    persistenceMode: 'in-memory-until-postgresql-warmup-policy-table-enabled',
    realDeliveryAllowed: false
  };
};

const dailyCapForDay = (policy, dayNumber) => {
  let cap = policy.startDailyCap;
  for (let index = 1; index < dayNumber; index += 1) cap = Math.min(policy.maxDailyCap, Math.ceil(cap * (1 + policy.rampPercent / 100)));
  return cap;
};

export const evaluateWarmupScheduleCap = ({ domain = DEFAULT_POLICY.domain, scheduledAt, estimatedAudience = 0, existingScheduledCount = 0 } = {}) => {
  const cleanDomain = normalizeDomain(domain || DEFAULT_POLICY.domain);
  const policy = policies.get(cleanDomain) || policies.get(DEFAULT_POLICY.domain) || { ...DEFAULT_POLICY };
  const scheduleDate = dateOnly(scheduledAt);
  const errors = [];
  if (!DOMAIN_RE.test(cleanDomain)) errors.push('valid_sender_domain_required');
  if (!scheduleDate) errors.push('valid_scheduled_at_required');
  if (errors.length > 0) return { ok: false, errors, realDeliveryAllowed: false };

  const offset = daysBetween(scheduleDate, policy.startDate);
  const dayNumber = Math.min(policy.days, Math.max(1, offset + 1));
  const dailyCap = dailyCapForDay(policy, dayNumber);
  const plannedCount = Number(estimatedAudience || 0) + Number(existingScheduledCount || 0);
  const remainingCap = Math.max(0, dailyCap - Number(existingScheduledCount || 0));
  const capExceeded = plannedCount > dailyCap;

  return {
    ok: true,
    mode: 'warmup-schedule-cap-evaluation',
    domain: cleanDomain,
    policy: { ...policy },
    scheduleDate,
    dayNumber,
    dailyCap,
    existingScheduledCount: Number(existingScheduledCount || 0),
    estimatedAudience: Number(estimatedAudience || 0),
    plannedCount,
    remainingCap,
    capExceeded,
    errors: capExceeded ? ['warmup_daily_cap_exceeded'] : [],
    enforcement: {
      appliesToCampaignSchedule: true,
      dryRunOnly: true,
      noQueueMutation: true,
      noProviderMutation: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};
