import { enqueueDryRunSend } from './sendQueue.js';
import { estimateSegmentAudience, getSegment } from './segments.js';
import { buildClickTrackingUrl, buildOpenTrackingUrl, buildUnsubscribeUrl, getTemplate, renderTemplateContent } from './templates.js';

const campaigns = new Map();
let sequence = 0;

const nowIso = () => new Date().toISOString();

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
    estimate
  };
};

export const listCampaigns = () => ({
  ok: true,
  count: campaigns.size,
  campaigns: [...campaigns.values()].map((campaign) => ({ ...campaign }))
});

export const getCampaign = (id) => {
  const campaign = campaigns.get(String(id || '').trim());
  return campaign ? { ...campaign } : null;
};

export const approveCampaignDryRun = ({ campaignId, actorEmail = null }) => {
  const campaign = campaigns.get(String(campaignId || '').trim());
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
  campaigns.set(campaign.id, updated);

  return {
    ok: true,
    mode: 'campaign-dry-run-approval',
    campaign: { ...updated },
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

export const scheduleCampaignDryRun = ({ campaignId, scheduledAt, actorEmail = null }) => {
  const campaign = campaigns.get(String(campaignId || '').trim());
  if (!campaign) return { ok: false, errors: ['campaign_not_found'] };
  if (campaign.status !== 'approved_dry_run') return { ok: false, errors: ['campaign_must_be_approved_dry_run'] };

  const scheduledDate = new Date(String(scheduledAt || ''));
  const errors = [];
  if (Number.isNaN(scheduledDate.getTime())) errors.push('valid_scheduled_at_required');
  if (!Number.isNaN(scheduledDate.getTime()) && scheduledDate.getTime() <= Date.now()) errors.push('scheduled_at_must_be_future');
  const estimate = estimateCampaign({ segmentId: campaign.segmentId, templateId: campaign.templateId });
  if (!estimate.ok) errors.push(...estimate.errors);
  if (estimate.ok && estimate.estimatedAudience < 1) errors.push('campaign_audience_required');
  if (errors.length > 0) return { ok: false, errors };

  const updated = {
    ...campaign,
    status: 'scheduled_dry_run',
    scheduledAt: scheduledDate.toISOString(),
    scheduledBy: actorEmail,
    realDeliveryAllowed: false,
    updatedAt: nowIso()
  };
  campaigns.set(campaign.id, updated);

  return {
    ok: true,
    mode: 'campaign-dry-run-schedule',
    campaign: { ...updated },
    compliance: {
      consentSource: 'segment_contacts_prevalidated',
      suppressionsExcluded: true,
      unsubscribeLanguagePresent: true,
      unsubscribeLinkInjected: true,
      rateLimitsRequiredAtQueue: true,
      manualDispatchRequired: true,
      realDeliveryAllowed: false
    },
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
  const campaign = campaigns.get(String(campaignId || '').trim());
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
  campaigns.set(campaign.id, updated);

  return {
    ok: true,
    mode: 'campaign-dry-run-queue',
    campaign: { ...updated },
    enqueuedCount: jobs.length,
    jobs,
    realDelivery: false
  };
};
