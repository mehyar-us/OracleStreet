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
