import { listEmailEvents } from './emailEvents.js';

const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;
const DEFAULT_POLICY = {
  domain: 'stuffprettygood.com',
  bounceRateThreshold: 0.03,
  complaintRateThreshold: 0.001,
  deferralRateThreshold: 0.08,
  providerErrorRateThreshold: 0.02,
  minimumEvents: 25,
  actionMode: 'recommendation_only'
};

let policy = { ...DEFAULT_POLICY };

const normalizeDomain = (domain) => String(domain || '').trim().toLowerCase();
const emailDomain = (email) => String(email || '').trim().toLowerCase().split('@')[1] || '';
const parseRate = (value, fallback) => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const resetReputationControlsForTests = () => {
  policy = { ...DEFAULT_POLICY };
};

export const getReputationPolicy = () => ({
  ok: true,
  mode: 'reputation-auto-pause-policy',
  policy: { ...policy },
  persistenceMode: 'in-memory-until-postgresql-policy-table-enabled',
  mutationScope: 'policy_only_no_queue_or_provider_pause',
  realDeliveryAllowed: false
});

export const saveReputationPolicy = (incoming = {}) => {
  const cleanDomain = normalizeDomain(incoming.domain || policy.domain);
  const next = {
    domain: cleanDomain,
    bounceRateThreshold: parseRate(incoming.bounceRateThreshold, policy.bounceRateThreshold),
    complaintRateThreshold: parseRate(incoming.complaintRateThreshold, policy.complaintRateThreshold),
    deferralRateThreshold: parseRate(incoming.deferralRateThreshold, policy.deferralRateThreshold),
    providerErrorRateThreshold: parseRate(incoming.providerErrorRateThreshold, policy.providerErrorRateThreshold),
    minimumEvents: parsePositiveInt(incoming.minimumEvents, policy.minimumEvents),
    actionMode: 'recommendation_only'
  };
  const errors = [];

  if (!DOMAIN_RE.test(next.domain)) errors.push('valid_sender_domain_required');
  for (const key of ['bounceRateThreshold', 'complaintRateThreshold', 'deferralRateThreshold', 'providerErrorRateThreshold']) {
    if (next[key] < 0 || next[key] > 1) errors.push(`${key}_must_be_between_0_and_1`);
  }
  if (next.minimumEvents < 1 || next.minimumEvents > 100000) errors.push('minimum_events_1_100000_required');
  if (errors.length > 0) return { ok: false, errors, realDeliveryAllowed: false };

  policy = next;
  return {
    ok: true,
    mode: 'reputation-auto-pause-policy-saved',
    policy: { ...policy },
    persistenceMode: 'in-memory-until-postgresql-policy-table-enabled',
    mutationScope: 'policy_only_no_queue_or_provider_pause',
    realDeliveryAllowed: false
  };
};

export const evaluateAutoPause = ({ domain = policy.domain } = {}) => {
  const cleanDomain = normalizeDomain(domain || policy.domain);
  const allEvents = listEmailEvents().events || [];
  const domainEvents = allEvents.filter((event) => emailDomain(event.email) === cleanDomain);
  const counts = domainEvents.reduce((totals, event) => {
    totals[event.type] = (totals[event.type] || 0) + 1;
    if (['delivered', 'deferred', 'bounce', 'complaint', 'dispatched'].includes(event.type)) totals.denominator += 1;
    return totals;
  }, { delivered: 0, deferred: 0, bounce: 0, complaint: 0, dispatched: 0, provider_error: 0, denominator: 0 });

  const denominator = Math.max(1, counts.denominator);
  const rates = {
    bounceRate: counts.bounce / denominator,
    complaintRate: counts.complaint / denominator,
    deferralRate: counts.deferred / denominator,
    providerErrorRate: counts.provider_error / denominator
  };

  const thresholdBreaches = [];
  if (counts.denominator >= policy.minimumEvents) {
    if (rates.bounceRate >= policy.bounceRateThreshold) thresholdBreaches.push('bounce_rate_threshold_exceeded');
    if (rates.complaintRate >= policy.complaintRateThreshold) thresholdBreaches.push('complaint_rate_threshold_exceeded');
    if (rates.deferralRate >= policy.deferralRateThreshold) thresholdBreaches.push('deferral_rate_threshold_exceeded');
    if (rates.providerErrorRate >= policy.providerErrorRateThreshold) thresholdBreaches.push('provider_error_rate_threshold_exceeded');
  }

  const insufficientData = counts.denominator < policy.minimumEvents;
  return {
    ok: true,
    mode: 'reputation-auto-pause-evaluation',
    domain: cleanDomain,
    policy: { ...policy },
    counts,
    rates,
    thresholdBreaches,
    insufficientData,
    recommendPause: thresholdBreaches.length > 0,
    recommendedAction: thresholdBreaches.length > 0
      ? 'pause_sends_for_domain_and_review_bounce_complaint_deferral_sources'
      : insufficientData
        ? 'keep_collecting_dry_run_and_imported_delivery_events_before_auto_pause_decision'
        : 'continue_warmup_under_current_caps',
    safety: {
      recommendationOnly: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noExternalDelivery: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};
