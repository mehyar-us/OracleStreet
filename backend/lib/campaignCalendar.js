import { listCampaigns } from './campaigns.js';
import { evaluateWarmupScheduleCap, listWarmupPolicies } from './warmupPolicies.js';

const normalizeDomain = (domain) => String(domain || 'stuffprettygood.com').trim().toLowerCase();
const dateOnly = (value) => {
  const parsed = value ? new Date(String(value)) : new Date();
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};
const addDays = (dateString, days) => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const sameDate = (iso, day) => dateOnly(iso) === day;

const campaignPlannedCount = (campaign) => Number(campaign.warmupPlannedCount || campaign.estimatedAudience || 0);

export const scheduledWarmupCount = ({ domain = 'stuffprettygood.com', scheduledAt, excludeCampaignId = null } = {}) => {
  const cleanDomain = normalizeDomain(domain);
  const scheduleDate = dateOnly(scheduledAt);
  if (!scheduleDate) return 0;
  return (listCampaigns().campaigns || [])
    .filter((campaign) => campaign.id !== excludeCampaignId)
    .filter((campaign) => campaign.status === 'scheduled_dry_run')
    .filter((campaign) => normalizeDomain(campaign.senderDomain || domain) === cleanDomain)
    .filter((campaign) => sameDate(campaign.scheduledAt, scheduleDate))
    .reduce((total, campaign) => total + campaignPlannedCount(campaign), 0);
};

export const campaignCalendar = ({ domain = 'stuffprettygood.com', startDate = null, days = 14 } = {}) => {
  const cleanDomain = normalizeDomain(domain);
  const firstDate = dateOnly(startDate) || new Date().toISOString().slice(0, 10);
  const dayCount = Math.max(1, Math.min(60, Number(days) || 14));
  const campaigns = (listCampaigns().campaigns || [])
    .filter((campaign) => campaign.status === 'scheduled_dry_run')
    .filter((campaign) => normalizeDomain(campaign.senderDomain || cleanDomain) === cleanDomain);
  const policies = listWarmupPolicies();
  const calendar = [];

  for (let index = 0; index < dayCount; index += 1) {
    const day = addDays(firstDate, index);
    const dayCampaigns = campaigns.filter((campaign) => sameDate(campaign.scheduledAt, day));
    const scheduledCount = dayCampaigns.reduce((total, campaign) => total + campaignPlannedCount(campaign), 0);
    const cap = evaluateWarmupScheduleCap({ domain: cleanDomain, scheduledAt: `${day}T12:00:00.000Z`, estimatedAudience: 0, existingScheduledCount: scheduledCount });
    calendar.push({
      date: day,
      domain: cleanDomain,
      dailyCap: cap.dailyCap || 0,
      scheduledCount,
      remainingCap: cap.remainingCap ?? 0,
      capExceeded: Boolean(cap.capExceeded),
      warmupDay: cap.dayNumber || null,
      campaigns: dayCampaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        scheduledAt: campaign.scheduledAt,
        estimatedAudience: campaign.estimatedAudience,
        plannedCount: campaignPlannedCount(campaign),
        senderDomain: campaign.senderDomain,
        realDeliveryAllowed: false
      }))
    });
  }

  const totalScheduled = calendar.reduce((total, day) => total + day.scheduledCount, 0);
  const totalCap = calendar.reduce((total, day) => total + day.dailyCap, 0);
  return {
    ok: true,
    mode: 'campaign-calendar-warmup-caps',
    domain: cleanDomain,
    startDate: firstDate,
    days: dayCount,
    totals: {
      scheduledCampaigns: campaigns.length,
      scheduledRecipients: totalScheduled,
      calendarCap: totalCap,
      remainingCap: Math.max(0, totalCap - totalScheduled),
      overCapDays: calendar.filter((day) => day.capExceeded).length
    },
    policies: policies.policies || [],
    calendar,
    safety: {
      adminOnly: true,
      dryRunOnly: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noDeliveryUnlock: true,
      realDeliveryAllowed: false
    },
    persistenceMode: listCampaigns().persistenceMode,
    realDeliveryAllowed: false
  };
};

export const campaignCalendarDrilldown = ({ domain = 'stuffprettygood.com', date = null } = {}) => {
  const cleanDomain = normalizeDomain(domain);
  const day = dateOnly(date) || new Date().toISOString().slice(0, 10);
  const base = campaignCalendar({ domain: cleanDomain, startDate: day, days: 1 });
  const calendarDay = base.calendar[0] || { campaigns: [], dailyCap: 0, scheduledCount: 0, remainingCap: 0, capExceeded: false };
  const campaigns = calendarDay.campaigns || [];
  const usageRate = calendarDay.dailyCap > 0 ? calendarDay.scheduledCount / calendarDay.dailyCap : 0;
  const recommendations = [];
  if (calendarDay.capExceeded) recommendations.push('move_or_split_campaigns_before_queue_enqueue');
  if (usageRate >= 0.8 && !calendarDay.capExceeded) recommendations.push('avoid_adding_more_campaigns_to_this_day');
  if (campaigns.length === 0) recommendations.push('day_has_capacity_for_future_dry_run_schedule');
  if (calendarDay.remainingCap <= 0) recommendations.push('use_next_available_warmup_day');

  return {
    ok: true,
    mode: 'campaign-calendar-warmup-drilldown',
    domain: cleanDomain,
    date: day,
    day: calendarDay,
    capacity: {
      dailyCap: calendarDay.dailyCap,
      planned: calendarDay.scheduledCount,
      remaining: calendarDay.remainingCap,
      usageRate,
      capExceeded: calendarDay.capExceeded,
      warmupDay: calendarDay.warmupDay
    },
    campaignBreakdown: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      plannedCount: campaign.plannedCount,
      scheduledAt: campaign.scheduledAt,
      senderDomain: campaign.senderDomain,
      status: campaign.status,
      realDeliveryAllowed: false
    })),
    recommendations,
    safety: {
      adminOnly: true,
      readOnly: true,
      dryRunOnly: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noScheduleMutation: true,
      noDeliveryUnlock: true,
      realDeliveryAllowed: false
    },
    persistenceMode: base.persistenceMode,
    realDeliveryAllowed: false
  };
};

export const campaignCalendarAllocation = ({ domains = '', startDate = null, days = 14 } = {}) => {
  const firstDate = dateOnly(startDate) || new Date().toISOString().slice(0, 10);
  const dayCount = Math.max(1, Math.min(60, Number(days) || 14));
  const scheduledCampaigns = (listCampaigns().campaigns || []).filter((campaign) => campaign.status === 'scheduled_dry_run');
  const policyDomains = (listWarmupPolicies().policies || []).map((policy) => policy.domain);
  const requestedDomains = String(domains || '').split(',').map(normalizeDomain).filter(Boolean);
  const domainList = [...new Set([
    ...requestedDomains,
    ...policyDomains.map(normalizeDomain),
    ...scheduledCampaigns.map((campaign) => normalizeDomain(campaign.senderDomain || 'stuffprettygood.com')),
    'stuffprettygood.com'
  ])].slice(0, 12);
  const domainAllocations = domainList.map((domain) => {
    const calendar = campaignCalendar({ domain, startDate: firstDate, days: dayCount });
    const tightDays = calendar.calendar.filter((day) => day.remainingCap <= Math.max(1, Math.ceil((day.dailyCap || 0) * 0.2))).length;
    return {
      domain,
      totals: calendar.totals,
      days: calendar.calendar.map((day) => ({
        date: day.date,
        dailyCap: day.dailyCap,
        scheduledCount: day.scheduledCount,
        remainingCap: day.remainingCap,
        capExceeded: day.capExceeded,
        campaignCount: day.campaigns.length,
        warmupDay: day.warmupDay,
        realDeliveryAllowed: false
      })),
      tightDays,
      recommendation: calendar.totals.overCapDays > 0
        ? 'move_or_split_over_cap_campaigns'
        : tightDays > 0
          ? 'reserve_tight_capacity_for_highest_priority_dry_runs'
          : 'capacity_available_for_dry_run_planning',
      realDeliveryAllowed: false
    };
  });
  const totals = domainAllocations.reduce((acc, entry) => ({
    domains: acc.domains + 1,
    scheduledCampaigns: acc.scheduledCampaigns + entry.totals.scheduledCampaigns,
    scheduledRecipients: acc.scheduledRecipients + entry.totals.scheduledRecipients,
    calendarCap: acc.calendarCap + entry.totals.calendarCap,
    remainingCap: acc.remainingCap + entry.totals.remainingCap,
    overCapDays: acc.overCapDays + entry.totals.overCapDays,
    tightDays: acc.tightDays + entry.tightDays
  }), { domains: 0, scheduledCampaigns: 0, scheduledRecipients: 0, calendarCap: 0, remainingCap: 0, overCapDays: 0, tightDays: 0 });

  return {
    ok: true,
    mode: 'campaign-calendar-multi-domain-allocation',
    startDate: firstDate,
    days: dayCount,
    totals,
    domainAllocations,
    recommendations: [
      totals.overCapDays > 0 ? 'resolve_over_cap_domain_days_before_enqueue' : 'no_over_cap_domain_days_detected',
      totals.tightDays > 0 ? 'review_tight_capacity_days_before_new_schedules' : 'multi_domain_capacity_available'
    ],
    safety: {
      adminOnly: true,
      readOnly: true,
      dryRunOnly: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noScheduleMutation: true,
      noDeliveryUnlock: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};

const nextCapacityDay = (days, afterDate, plannedCount = 1) => (days || [])
  .filter((day) => day.date > afterDate)
  .find((day) => (day.remainingCap || 0) >= plannedCount) || null;

export const campaignCalendarReschedulePlan = ({ domains = '', startDate = null, days = 14 } = {}) => {
  const allocation = campaignCalendarAllocation({ domains, startDate, days });
  const suggestions = [];
  for (const entry of allocation.domainAllocations || []) {
    const calendar = campaignCalendar({ domain: entry.domain, startDate: allocation.startDate, days: allocation.days });
    for (const day of calendar.calendar || []) {
      const tightThreshold = Math.max(1, Math.ceil((day.dailyCap || 0) * 0.2));
      const needsReview = day.capExceeded || (day.campaigns.length > 0 && day.remainingCap <= tightThreshold);
      if (!needsReview) continue;
      const campaigns = [...(day.campaigns || [])].sort((a, b) => (b.plannedCount || 0) - (a.plannedCount || 0));
      const candidate = campaigns[0] || null;
      const nextDay = nextCapacityDay(calendar.calendar, day.date, candidate?.plannedCount || 1);
      suggestions.push({
        domain: entry.domain,
        date: day.date,
        priority: day.capExceeded ? 'high' : 'medium',
        reason: day.capExceeded ? 'over_warmup_daily_cap' : 'tight_warmup_capacity',
        dailyCap: day.dailyCap,
        scheduledCount: day.scheduledCount,
        remainingCap: day.remainingCap,
        campaignCount: day.campaigns.length,
        candidateCampaign: candidate ? {
          id: candidate.id,
          name: candidate.name,
          plannedCount: candidate.plannedCount,
          scheduledAt: candidate.scheduledAt,
          status: candidate.status,
          realDeliveryAllowed: false
        } : null,
        suggestedDate: nextDay?.date || null,
        suggestedRemainingCap: nextDay?.remainingCap ?? null,
        action: nextDay ? 'operator_may_reschedule_in_campaign_builder_after_review' : 'extend_calendar_or_reduce_campaign_audience_before_scheduling',
        scheduleMutation: false,
        realDeliveryAllowed: false
      });
    }
  }
  suggestions.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.priority] - rank[b.priority] || a.date.localeCompare(b.date) || a.domain.localeCompare(b.domain);
  });

  return {
    ok: true,
    mode: 'campaign-calendar-reschedule-plan',
    startDate: allocation.startDate,
    days: allocation.days,
    totals: {
      domains: allocation.totals.domains,
      suggestions: suggestions.length,
      highPriority: suggestions.filter((item) => item.priority === 'high').length,
      mediumPriority: suggestions.filter((item) => item.priority === 'medium').length,
      suggestedMoveCandidates: suggestions.filter((item) => item.suggestedDate).length
    },
    suggestions,
    recommendations: suggestions.length
      ? [
        suggestions.some((item) => item.priority === 'high') ? 'resolve_over_cap_days_before_enqueue' : 'review_tight_days_before_new_schedules',
        suggestions.some((item) => item.suggestedDate) ? 'use_suggested_dates_for_operator_review_only' : 'extend_calendar_or_reduce_audience_for_capacity'
      ]
      : ['no_reschedule_candidates_detected_for_current_warmup_window'],
    safety: {
      adminOnly: true,
      readOnly: true,
      dryRunOnly: true,
      recommendationOnly: true,
      noScheduleMutation: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noNetworkProbe: true,
      noDeliveryUnlock: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};
