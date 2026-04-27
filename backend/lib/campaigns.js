import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';
import { enqueueDryRunSend } from './sendQueue.js';
import { estimateSegmentAudience, getSegment } from './segments.js';
import { buildClickTrackingUrl, buildOpenTrackingUrl, buildUnsubscribeUrl, getTemplate, renderTemplateContent } from './templates.js';
import { evaluateWarmupScheduleCap } from './warmupPolicies.js';

const campaigns = new Map();
let sequence = 0;

const nowIso = () => new Date().toISOString();

const pgRowToCampaign = ([id, name, status, segmentId, templateId, estimatedAudience, suppressedCount, approvedBy, approvedAt, scheduledAt, senderDomain, warmupDay, warmupDailyCap, warmupPlannedCount, scheduledBy, queuedDryRunCount, createdAt, updatedAt]) => ({
  id,
  name,
  status,
  segmentId: segmentId || null,
  templateId: templateId || null,
  estimatedAudience: Number(estimatedAudience || 0),
  suppressedCount: Number(suppressedCount || 0),
  approvedBy: approvedBy || null,
  approvedAt: approvedAt || null,
  scheduledAt: scheduledAt || null,
  senderDomain: senderDomain || null,
  warmupDay: warmupDay ? Number(warmupDay) : null,
  warmupDailyCap: warmupDailyCap ? Number(warmupDailyCap) : null,
  warmupPlannedCount: warmupPlannedCount ? Number(warmupPlannedCount) : null,
  scheduledBy: scheduledBy || null,
  queuedDryRunCount: Number(queuedDryRunCount || 0),
  realDeliveryAllowed: false,
  actorEmail: null,
  createdAt,
  updatedAt: updatedAt || null
});

const campaignSelect = `id::text, name, status, coalesce(segment_id, ''), coalesce(template_id, ''), estimated_audience::text, suppressed_count::text, coalesce(approved_by, ''), coalesce(approved_at::text, ''), coalesce(scheduled_at::text, ''), coalesce(sender_domain, ''), coalesce(warmup_day::text, ''), coalesce(warmup_daily_cap::text, ''), coalesce(warmup_planned_count::text, ''), coalesce(scheduled_by, ''), queued_dry_run_count::text, created_at::text, updated_at::text`;

const listCampaignsFromPostgres = () => runLocalPgRows(`
  SELECT ${campaignSelect}
  FROM campaigns
  ORDER BY created_at DESC, name ASC
  LIMIT 1000;
`).map(pgRowToCampaign);

const getCampaignFromPostgres = (id) => {
  const rows = runLocalPgRows(`
    SELECT ${campaignSelect}
    FROM campaigns
    WHERE id::text = ${sqlLiteral(String(id || '').trim())}
    LIMIT 1;
  `);
  return rows[0] ? pgRowToCampaign(rows[0]) : null;
};

const updateCampaignInPostgres = (campaign, fields = {}) => {
  const updates = Object.entries(fields).map(([column, value]) => `${column} = ${value}`).join(', ');
  const rows = runLocalPgRows(`
    UPDATE campaigns
    SET ${updates}${updates ? ', ' : ''}updated_at = now()
    WHERE id::text = ${sqlLiteral(campaign.id)}
    RETURNING ${campaignSelect};
  `);
  return rows[0] ? pgRowToCampaign(rows[0]) : null;
};

export const resetCampaignsForTests = () => {
  campaigns.clear();
  sequence = 0;
};

export const estimateCampaign = ({ segmentId, templateId }) => {
  const segment = getSegment(segmentId);
  const template = getTemplate(templateId);
  const errors = [];

  if (!segment) errors.push('segment_not_found');
  if (!template) errors.push('template_not_found');
  if (template && !/unsubscribe/i.test(template.html)) errors.push('unsubscribe_language_required');
  if (errors.length > 0) return { ok: false, errors };

  const audience = estimateSegmentAudience(segment.criteria);
  if (!audience.ok) return { ok: false, errors: audience.errors };

  return {
    ok: true,
    mode: 'safe-campaign-estimate',
    segment: { id: segment.id, name: segment.name, criteria: segment.criteria },
    template: { id: template.id, name: template.name, subject: template.subject },
    estimatedAudience: audience.estimatedAudience,
    suppressedCount: audience.suppressedCount,
    totalContacts: audience.totalContacts,
    compliance: {
      consentSource: 'segment_contacts_prevalidated',
      suppressionsExcluded: true,
      unsubscribeLanguagePresent: true,
      unsubscribeLinkInjected: true,
      realDeliveryAllowed: false
    },
    realDelivery: false
  };
};

export const createCampaign = ({ name, segmentId, templateId, actorEmail = null }) => {
  const cleanName = String(name || '').trim();
  const errors = [];
  if (!cleanName) errors.push('campaign_name_required');
  const estimate = estimateCampaign({ segmentId, templateId });
  if (!estimate.ok) errors.push(...estimate.errors);
  if (errors.length > 0) return { ok: false, errors };

  if (isPgRepositoryEnabled('campaigns')) {
    try {
      const rows = runLocalPgRows(`
        INSERT INTO campaigns (name, status, segment_id, template_id, estimated_audience, suppressed_count, updated_at)
        VALUES (${sqlLiteral(cleanName)}, 'draft', ${sqlLiteral(segmentId)}, ${sqlLiteral(templateId)}, ${Number(estimate.estimatedAudience || 0)}, ${Number(estimate.suppressedCount || 0)}, now())
        RETURNING ${campaignSelect};
      `);
      return {
        ok: true,
        mode: 'postgresql-campaign-draft',
        campaign: pgRowToCampaign(rows[0]),
        estimate,
        persistenceMode: 'postgresql-local-psql-repository'
      };
    } catch (error) {
      // Safe fallback keeps campaign drafting available if the local psql adapter is unavailable.
    }
  }

  const campaign = {
    id: `cmp_${(++sequence).toString().padStart(6, '0')}`,
    name: cleanName,
    segmentId,
    templateId,
    status: 'draft',
    estimatedAudience: estimate.estimatedAudience,
    suppressedCount: estimate.suppressedCount,
    realDeliveryAllowed: false,
    actorEmail,
    createdAt: nowIso(),
    updatedAt: null
  };
  campaigns.set(campaign.id, campaign);

  return {
    ok: true,
    mode: 'in-memory-campaign-draft',
    campaign: { ...campaign },
    estimate,
    persistenceMode: isPgRepositoryEnabled('campaigns') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};

export const listCampaigns = () => {
  if (isPgRepositoryEnabled('campaigns')) {
    try {
      const pgCampaigns = listCampaignsFromPostgres();
      return { ok: true, count: pgCampaigns.length, campaigns: pgCampaigns, persistenceMode: 'postgresql-local-psql-repository' };
    } catch (error) {
      // fall through to in-memory view
    }
  }
  return {
    ok: true,
    count: campaigns.size,
    campaigns: [...campaigns.values()].map((campaign) => ({ ...campaign })),
    persistenceMode: isPgRepositoryEnabled('campaigns') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};

export const getCampaign = (id) => {
  if (isPgRepositoryEnabled('campaigns')) {
    try { return getCampaignFromPostgres(id); } catch (error) { /* fall through */ }
  }
  const campaign = campaigns.get(String(id || '').trim());
  return campaign ? { ...campaign } : null;
};

export const approveCampaignDryRun = ({ campaignId, actorEmail = null }) => {
  const campaign = getCampaign(campaignId);
  if (!campaign) return { ok: false, errors: ['campaign_not_found'] };
  if (campaign.status !== 'draft') return { ok: false, errors: ['campaign_must_be_draft'] };

  const estimate = estimateCampaign({ segmentId: campaign.segmentId, templateId: campaign.templateId });
  if (!estimate.ok) return estimate;
  if (estimate.estimatedAudience < 1) return { ok: false, errors: ['campaign_audience_required'] };

  const updated = {
    ...campaign,
    status: 'approved_dry_run',
    approvedBy: actorEmail,
    approvedAt: nowIso(),
    realDeliveryAllowed: false,
    updatedAt: nowIso()
  };
  let saved = updated;
  if (isPgRepositoryEnabled('campaigns')) {
    try {
      saved = updateCampaignInPostgres(campaign, {
        status: sqlLiteral('approved_dry_run'),
        approved_by: sqlLiteral(actorEmail),
        approved_at: 'now()'
      }) || updated;
    } catch (error) {
      campaigns.set(campaign.id, updated);
    }
  } else {
    campaigns.set(campaign.id, updated);
  }

  return {
    ok: true,
    mode: 'campaign-dry-run-approval',
    campaign: { ...saved },
    compliance: {
      consentSource: 'segment_contacts_prevalidated',
      suppressionsExcluded: true,
      unsubscribeLanguagePresent: true,
      unsubscribeLinkInjected: true,
      rateLimitsRequiredAtQueue: true,
      realDeliveryAllowed: false
    },
    realDelivery: false
  };
};

export const scheduleCampaignDryRun = ({ campaignId, scheduledAt, senderDomain = 'stuffprettygood.com', actorEmail = null }) => {
  const campaign = getCampaign(campaignId);
  if (!campaign) return { ok: false, errors: ['campaign_not_found'] };
  if (campaign.status !== 'approved_dry_run') return { ok: false, errors: ['campaign_must_be_approved_dry_run'] };

  const scheduledDate = new Date(String(scheduledAt || ''));
  const errors = [];
  if (Number.isNaN(scheduledDate.getTime())) errors.push('valid_scheduled_at_required');
  if (!Number.isNaN(scheduledDate.getTime()) && scheduledDate.getTime() <= Date.now()) errors.push('scheduled_at_must_be_future');
  const estimate = estimateCampaign({ segmentId: campaign.segmentId, templateId: campaign.templateId });
  if (!estimate.ok) errors.push(...estimate.errors);
  if (estimate.ok && estimate.estimatedAudience < 1) errors.push('campaign_audience_required');
  const warmupCap = estimate.ok ? evaluateWarmupScheduleCap({ domain: senderDomain, scheduledAt, estimatedAudience: estimate.estimatedAudience }) : null;
  if (warmupCap && !warmupCap.ok) errors.push(...warmupCap.errors);
  if (warmupCap?.capExceeded) errors.push('warmup_daily_cap_exceeded');
  if (errors.length > 0) return { ok: false, errors, warmupCap, realDelivery: false };

  const updated = {
    ...campaign,
    status: 'scheduled_dry_run',
    scheduledAt: scheduledDate.toISOString(),
    senderDomain: warmupCap.domain,
    warmupDay: warmupCap.dayNumber,
    warmupDailyCap: warmupCap.dailyCap,
    warmupPlannedCount: warmupCap.plannedCount,
    scheduledBy: actorEmail,
    realDeliveryAllowed: false,
    updatedAt: nowIso()
  };
  let saved = updated;
  if (isPgRepositoryEnabled('campaigns')) {
    try {
      saved = updateCampaignInPostgres(campaign, {
        status: sqlLiteral('scheduled_dry_run'),
        scheduled_at: sqlLiteral(scheduledDate.toISOString()),
        sender_domain: sqlLiteral(warmupCap.domain),
        warmup_day: Number(warmupCap.dayNumber || 0),
        warmup_daily_cap: Number(warmupCap.dailyCap || 0),
        warmup_planned_count: Number(warmupCap.plannedCount || 0),
        scheduled_by: sqlLiteral(actorEmail)
      }) || updated;
    } catch (error) {
      campaigns.set(campaign.id, updated);
    }
  } else {
    campaigns.set(campaign.id, updated);
  }

  return {
    ok: true,
    mode: 'campaign-dry-run-schedule',
    campaign: { ...saved },
    compliance: {
      consentSource: 'segment_contacts_prevalidated',
      suppressionsExcluded: true,
      unsubscribeLanguagePresent: true,
      unsubscribeLinkInjected: true,
      rateLimitsRequiredAtQueue: true,
      manualDispatchRequired: true,
      warmupCapEnforced: true,
      realDeliveryAllowed: false
    },
    warmupCap,
    realDelivery: false
  };
};

const contactRenderData = (contact) => ({
  email: contact.email,
  firstName: contact.firstName || '',
  lastName: contact.lastName || '',
  source: contact.source,
  consentStatus: contact.consentStatus
});

export const enqueueCampaignDryRun = ({ campaignId, actorEmail = null, env = process.env }) => {
  const campaign = getCampaign(campaignId);
  if (!campaign) return { ok: false, errors: ['campaign_not_found'] };
  if (!['approved_dry_run', 'scheduled_dry_run'].includes(campaign.status)) return { ok: false, errors: ['campaign_must_be_approved_or_scheduled_dry_run'] };

  const template = getTemplate(campaign.templateId);
  if (!template) return { ok: false, errors: ['template_not_found'] };
  const estimate = estimateCampaign({ segmentId: campaign.segmentId, templateId: campaign.templateId });
  if (!estimate.ok) return estimate;

  const audience = estimateSegmentAudience(estimate.segment.criteria);
  const jobs = [];
  const errors = [];

  for (const contact of audience.contacts) {
    const unsubscribeUrl = buildUnsubscribeUrl({ email: contact.email, campaignId: campaign.id, contactId: contact.id });
    const openTrackingUrl = buildOpenTrackingUrl({ email: contact.email, campaignId: campaign.id, contactId: contact.id });
    const clickTrackingUrl = buildClickTrackingUrl({ email: contact.email, campaignId: campaign.id, contactId: contact.id });
    const rendered = renderTemplateContent(template, contactRenderData(contact), { unsubscribeUrl, openTrackingUrl, clickTrackingUrl });
    const result = enqueueDryRunSend({
      to: contact.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      consentStatus: contact.consentStatus,
      source: contact.source,
      campaignId: campaign.id,
      contactId: contact.id,
      unsubscribeUrl: rendered.unsubscribeUrl,
      openTrackingUrl: rendered.openTrackingUrl,
      clickTrackingUrl: rendered.clickTrackingUrl
    }, actorEmail, env);
    if (!result.ok) {
      errors.push({ email: contact.email, errors: result.errors });
      continue;
    }
    jobs.push(result.job);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      mode: 'campaign-dry-run-queue',
      campaignId: campaign.id,
      enqueuedCount: jobs.length,
      rejectedCount: errors.length,
      errors,
      realDelivery: false
    };
  }

  const updated = {
    ...campaign,
    status: 'queued_dry_run',
    queuedDryRunCount: jobs.length,
    realDeliveryAllowed: false,
    updatedAt: nowIso()
  };
  let saved = updated;
  if (isPgRepositoryEnabled('campaigns')) {
    try {
      saved = updateCampaignInPostgres(campaign, {
        status: sqlLiteral('queued_dry_run'),
        queued_dry_run_count: Number(jobs.length || 0)
      }) || updated;
    } catch (error) {
      campaigns.set(campaign.id, updated);
    }
  } else {
    campaigns.set(campaign.id, updated);
  }

  return {
    ok: true,
    mode: 'campaign-dry-run-queue',
    campaign: { ...saved },
    enqueuedCount: jobs.length,
    jobs,
    realDelivery: false
  };
};
