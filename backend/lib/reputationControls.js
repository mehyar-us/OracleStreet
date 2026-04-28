import { listEmailEvents } from './emailEvents.js';
import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';

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

const pgRowToPolicy = ([domain, bounceRateThreshold, complaintRateThreshold, deferralRateThreshold, providerErrorRateThreshold, minimumEvents, actionMode]) => ({
  domain,
  bounceRateThreshold: Number(bounceRateThreshold),
  complaintRateThreshold: Number(complaintRateThreshold),
  deferralRateThreshold: Number(deferralRateThreshold),
  providerErrorRateThreshold: Number(providerErrorRateThreshold),
  minimumEvents: Number(minimumEvents),
  actionMode
});

const getReputationPolicyFromPostgres = (domain = policy.domain) => {
  const cleanDomain = normalizeDomain(domain || policy.domain);
  if (isPgRepositoryEnabled('reputation_policies')) {
    try {
      const rows = runLocalPgRows(`
        SELECT domain, bounce_rate_threshold::text, complaint_rate_threshold::text, deferral_rate_threshold::text, provider_error_rate_threshold::text, minimum_events, action_mode
        FROM reputation_policies
        WHERE domain IN (${sqlLiteral(cleanDomain)}, ${sqlLiteral(DEFAULT_POLICY.domain)})
        ORDER BY CASE WHEN domain = ${sqlLiteral(cleanDomain)} THEN 0 ELSE 1 END
        LIMIT 1;
      `);
      if (rows[0]) return pgRowToPolicy(rows[0]);
    } catch (error) {
      // fall through to in-memory/default policy
    }
  }
  return { ...policy };
};

export const getReputationPolicy = () => {
  if (isPgRepositoryEnabled('reputation_policies')) {
    try {
      return {
        ok: true,
        mode: 'reputation-auto-pause-policy',
        policy: getReputationPolicyFromPostgres(policy.domain),
        persistenceMode: 'postgresql-local-psql-repository',
        mutationScope: 'policy_only_no_queue_or_provider_pause',
        realDeliveryAllowed: false
      };
    } catch (error) {
      // fall through to in-memory view
    }
  }
  return {
    ok: true,
    mode: 'reputation-auto-pause-policy',
    policy: { ...policy },
    persistenceMode: isPgRepositoryEnabled('reputation_policies') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-policy-table-enabled',
    mutationScope: 'policy_only_no_queue_or_provider_pause',
    realDeliveryAllowed: false
  };
};

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

  if (isPgRepositoryEnabled('reputation_policies')) {
    try {
      const rows = runLocalPgRows(`
        INSERT INTO reputation_policies (domain, bounce_rate_threshold, complaint_rate_threshold, deferral_rate_threshold, provider_error_rate_threshold, minimum_events, action_mode, updated_at)
        VALUES (${sqlLiteral(next.domain)}, ${next.bounceRateThreshold}, ${next.complaintRateThreshold}, ${next.deferralRateThreshold}, ${next.providerErrorRateThreshold}, ${next.minimumEvents}, 'recommendation_only', now())
        ON CONFLICT (domain) DO UPDATE SET
          bounce_rate_threshold = EXCLUDED.bounce_rate_threshold,
          complaint_rate_threshold = EXCLUDED.complaint_rate_threshold,
          deferral_rate_threshold = EXCLUDED.deferral_rate_threshold,
          provider_error_rate_threshold = EXCLUDED.provider_error_rate_threshold,
          minimum_events = EXCLUDED.minimum_events,
          action_mode = EXCLUDED.action_mode,
          updated_at = now()
        RETURNING domain, bounce_rate_threshold::text, complaint_rate_threshold::text, deferral_rate_threshold::text, provider_error_rate_threshold::text, minimum_events, action_mode;
      `);
      const saved = pgRowToPolicy(rows[0]);
      policy = saved;
      return {
        ok: true,
        mode: 'reputation-auto-pause-policy-saved',
        policy: saved,
        persistenceMode: 'postgresql-local-psql-repository',
        mutationScope: 'policy_only_no_queue_or_provider_pause',
        realDeliveryAllowed: false
      };
    } catch (error) {
      // fall through to in-memory save
    }
  }

  policy = next;
  return {
    ok: true,
    mode: 'reputation-auto-pause-policy-saved',
    policy: { ...policy },
    persistenceMode: isPgRepositoryEnabled('reputation_policies') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-policy-table-enabled',
    mutationScope: 'policy_only_no_queue_or_provider_pause',
    realDeliveryAllowed: false
  };
};

export const evaluateAutoPause = ({ domain = policy.domain } = {}) => {
  const cleanDomain = normalizeDomain(domain || policy.domain);
  const activePolicy = getReputationPolicyFromPostgres(cleanDomain);
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
  if (counts.denominator >= activePolicy.minimumEvents) {
    if (rates.bounceRate >= activePolicy.bounceRateThreshold) thresholdBreaches.push('bounce_rate_threshold_exceeded');
    if (rates.complaintRate >= activePolicy.complaintRateThreshold) thresholdBreaches.push('complaint_rate_threshold_exceeded');
    if (rates.deferralRate >= activePolicy.deferralRateThreshold) thresholdBreaches.push('deferral_rate_threshold_exceeded');
    if (rates.providerErrorRate >= activePolicy.providerErrorRateThreshold) thresholdBreaches.push('provider_error_rate_threshold_exceeded');
  }

  const insufficientData = counts.denominator < activePolicy.minimumEvents;
  return {
    ok: true,
    mode: 'reputation-auto-pause-evaluation',
    domain: cleanDomain,
    policy: { ...activePolicy },
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

export const evaluateDomainReputationRollup = ({ limit = 12 } = {}) => {
  const maxRows = Math.min(Math.max(parsePositiveInt(limit, 12), 1), 50);
  const allEvents = listEmailEvents().events || [];
  const grouped = new Map();
  for (const event of allEvents) {
    const domain = emailDomain(event.email);
    if (!domain) continue;
    const entry = grouped.get(domain) || { domain, delivered: 0, deferred: 0, bounce: 0, complaint: 0, dispatched: 0, provider_error: 0, denominator: 0, latestEventAt: null };
    entry[event.type] = (entry[event.type] || 0) + 1;
    if (['delivered', 'deferred', 'bounce', 'complaint', 'dispatched'].includes(event.type)) entry.denominator += 1;
    if (!entry.latestEventAt || String(event.createdAt || '') > entry.latestEventAt) entry.latestEventAt = event.createdAt || null;
    grouped.set(domain, entry);
  }

  const domains = [...grouped.values()].map((counts) => {
    const activePolicy = getReputationPolicyFromPostgres(counts.domain);
    const denominator = Math.max(1, counts.denominator);
    const rates = {
      bounceRate: counts.bounce / denominator,
      complaintRate: counts.complaint / denominator,
      deferralRate: counts.deferred / denominator,
      providerErrorRate: counts.provider_error / denominator
    };
    const breaches = [];
    if (counts.denominator >= activePolicy.minimumEvents) {
      if (rates.bounceRate >= activePolicy.bounceRateThreshold) breaches.push('bounce_rate_threshold_exceeded');
      if (rates.complaintRate >= activePolicy.complaintRateThreshold) breaches.push('complaint_rate_threshold_exceeded');
      if (rates.deferralRate >= activePolicy.deferralRateThreshold) breaches.push('deferral_rate_threshold_exceeded');
      if (rates.providerErrorRate >= activePolicy.providerErrorRateThreshold) breaches.push('provider_error_rate_threshold_exceeded');
    }
    const insufficientData = counts.denominator < activePolicy.minimumEvents;
    return {
      domain: counts.domain,
      counts,
      rates,
      thresholdBreaches: breaches,
      insufficientData,
      recommendation: breaches.length > 0
        ? 'pause_or_reduce_domain_until_events_are_reviewed'
        : insufficientData
          ? 'collect_more_delivery_events_before_domain_decision'
          : 'continue_under_current_warmup_caps',
      recommendationOnly: true
    };
  }).sort((a, b) => {
    if (b.thresholdBreaches.length !== a.thresholdBreaches.length) return b.thresholdBreaches.length - a.thresholdBreaches.length;
    if (b.counts.denominator !== a.counts.denominator) return b.counts.denominator - a.counts.denominator;
    return a.domain.localeCompare(b.domain);
  }).slice(0, maxRows);

  return {
    ok: true,
    mode: 'domain-reputation-rollup',
    count: domains.length,
    totalDomains: grouped.size,
    domains,
    safety: {
      recommendationOnly: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noNetworkProbe: true,
      noExternalDelivery: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};
