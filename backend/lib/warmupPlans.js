const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeDomain = (domain) => String(domain || '').trim().toLowerCase();

export const planWarmupSchedule = ({ domain, startDailyCap = 25, maxDailyCap = 500, rampPercent = 25, days = 14 } = {}) => {
  const cleanDomain = normalizeDomain(domain);
  const cleanStart = parsePositiveInt(startDailyCap, 25);
  const cleanMax = parsePositiveInt(maxDailyCap, 500);
  const cleanRamp = parsePositiveInt(rampPercent, 25);
  const cleanDays = parsePositiveInt(days, 14);
  const errors = [];

  if (!DOMAIN_RE.test(cleanDomain)) errors.push('valid_sender_domain_required');
  if (cleanStart < 1 || cleanStart > 10000) errors.push('valid_start_daily_cap_required');
  if (cleanMax < cleanStart || cleanMax > 100000) errors.push('valid_max_daily_cap_required');
  if (cleanRamp < 1 || cleanRamp > 100) errors.push('valid_ramp_percent_1_100_required');
  if (cleanDays < 1 || cleanDays > 90) errors.push('valid_days_1_90_required');
  if (errors.length > 0) return { ok: false, errors, realDeliveryAllowed: false };

  let cap = cleanStart;
  const schedule = Array.from({ length: cleanDays }, (_, index) => {
    if (index > 0) cap = Math.min(cleanMax, Math.ceil(cap * (1 + cleanRamp / 100)));
    return {
      day: index + 1,
      domain: cleanDomain,
      dailyCap: cap,
      perHourCap: Math.max(1, Math.ceil(cap / 24)),
      bouncePauseThreshold: 0.03,
      complaintPauseThreshold: 0.001,
      action: 'monitor_before_increase'
    };
  });

  return {
    ok: true,
    mode: 'warmup-plan-safe-preview',
    domain: cleanDomain,
    inputs: {
      startDailyCap: cleanStart,
      maxDailyCap: cleanMax,
      rampPercent: cleanRamp,
      days: cleanDays
    },
    schedule,
    gates: {
      consentSourceRequired: true,
      suppressionRequired: true,
      unsubscribeRequired: true,
      bounceComplaintAutoPauseRequired: true,
      senderDomainReadinessRequired: true,
      controlledLiveApprovalRequired: true
    },
    safety: {
      previewOnly: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noDnsProbe: true,
      noExternalDelivery: true,
      realDeliveryAllowed: false
    },
    nextStep: 'review_sender_domain_readiness_then_repeat_dry_run_proof',
    realDeliveryAllowed: false
  };
};
