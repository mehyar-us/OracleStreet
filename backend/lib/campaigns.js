import { estimateSegmentAudience, getSegment } from './segments.js';
import { getTemplate } from './templates.js';

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
