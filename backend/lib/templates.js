const templates = new Map();
let sequence = 0;

const nowIso = () => new Date().toISOString();
const renderToken = (content, data = {}) => String(content || '').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key) => {
  const value = data[key];
  return value === undefined || value === null ? '' : String(value);
});

const buildTrackedUrl = ({ path, email, campaignId = null, contactId = null, detail = null, baseUrl = '' } = {}) => {
  const params = new URLSearchParams();
  params.set('email', String(email || '').trim().toLowerCase());
  if (campaignId) params.set('campaignId', String(campaignId));
  if (contactId) params.set('contactId', String(contactId));
  if (detail) params.set(path.endsWith('/click') ? 'url' : 'detail', String(detail));
  return `${String(baseUrl || '').replace(/\/$/, '')}${path}?${params.toString()}`;
};

export const buildUnsubscribeUrl = ({ email, campaignId = null, contactId = null, baseUrl = '' } = {}) => {
  const params = new URLSearchParams();
  params.set('email', String(email || '').trim().toLowerCase());
  params.set('source', campaignId ? `campaign:${campaignId}` : 'template-preview');
  if (campaignId) params.set('campaignId', String(campaignId));
  if (contactId) params.set('contactId', String(contactId));
  return `${String(baseUrl || '').replace(/\/$/, '')}/api/unsubscribe?${params.toString()}`;
};

export const buildOpenTrackingUrl = (options = {}) => buildTrackedUrl({ ...options, path: '/api/track/open' });
export const buildClickTrackingUrl = (options = {}) => buildTrackedUrl({ ...options, path: '/api/track/click' });

const injectUnsubscribeLink = (html, unsubscribeUrl) => {
  if (!unsubscribeUrl) return html;
  if (/{{\s*unsubscribeUrl\s*}}/i.test(html)) return html;
  if (html.includes(unsubscribeUrl)) return html;
  return `${html}\n<p><a href="${unsubscribeUrl}">unsubscribe</a></p>`;
};

const injectOpenTrackingPixel = (html, openTrackingUrl) => {
  if (!openTrackingUrl) return html;
  if (/{{\s*openTrackingUrl\s*}}/i.test(html)) return html;
  if (html.includes(openTrackingUrl)) return html;
  return `${html}\n<img src="${openTrackingUrl}" alt="" width="1" height="1" style="display:none" />`;
};

export const resetTemplatesForTests = () => {
  templates.clear();
  sequence = 0;
};

export const validateTemplate = (template = {}) => {
  const name = String(template.name || '').trim();
  const subject = String(template.subject || '').trim();
  const html = String(template.html || '').trim();
  const text = String(template.text || '').trim() || null;
  const errors = [];

  if (!name) errors.push('template_name_required');
  if (!subject) errors.push('template_subject_required');
  if (!html) errors.push('template_html_required');
  if (html && !/unsubscribe/i.test(html)) errors.push('unsubscribe_language_required');

  return {
    ok: errors.length === 0,
    errors,
    template: { name, subject, html, text }
  };
};

export const createTemplate = ({ name, subject, html, text = null, actorEmail = null }) => {
  const validation = validateTemplate({ name, subject, html, text });
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const template = {
    id: `tpl_${(++sequence).toString().padStart(6, '0')}`,
    ...validation.template,
    status: 'draft',
    actorEmail,
    createdAt: nowIso(),
    updatedAt: null
  };
  templates.set(template.id, template);
  return { ok: true, mode: 'in-memory-template', template: { ...template } };
};

export const listTemplates = () => ({
  ok: true,
  count: templates.size,
  templates: [...templates.values()].map((template) => ({ ...template }))
});

export const getTemplate = (id) => templates.get(String(id || '').trim()) || null;

export const renderTemplateContent = (template, data = {}, options = {}) => {
  const unsubscribeUrl = options.unsubscribeUrl || data.unsubscribeUrl || null;
  const openTrackingUrl = options.openTrackingUrl || data.openTrackingUrl || null;
  const clickTrackingUrl = options.clickTrackingUrl || data.clickTrackingUrl || null;
  const renderData = { ...data, unsubscribeUrl: unsubscribeUrl || data.unsubscribeUrl, openTrackingUrl, clickTrackingUrl };
  const rawHtml = renderToken(template.html, renderData);
  const rawText = template.text ? renderToken(template.text, renderData) : null;
  const htmlWithUnsubscribe = injectUnsubscribeLink(rawHtml, unsubscribeUrl);
  return {
    subject: renderToken(template.subject, renderData),
    html: injectOpenTrackingPixel(htmlWithUnsubscribe, openTrackingUrl),
    text: unsubscribeUrl && rawText && !rawText.includes(unsubscribeUrl) ? `${rawText}\nUnsubscribe: ${unsubscribeUrl}` : rawText,
    unsubscribeUrl,
    openTrackingUrl,
    clickTrackingUrl,
    unsubscribeInjected: Boolean(unsubscribeUrl),
    openTrackingInjected: Boolean(openTrackingUrl)
  };
};

export const renderTemplatePreview = ({ id, data = {} }) => {
  const template = getTemplate(id);
  if (!template) return { ok: false, errors: ['template_not_found'] };

  const rendered = renderTemplateContent(template, data);

  return {
    ok: true,
    mode: 'safe-template-preview',
    templateId: template.id,
    rendered,
    realDelivery: false
  };
};
