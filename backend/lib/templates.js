const templates = new Map();
let sequence = 0;

const nowIso = () => new Date().toISOString();
const renderToken = (content, data = {}) => String(content || '').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key) => {
  const value = data[key];
  return value === undefined || value === null ? '' : String(value);
});

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

export const renderTemplatePreview = ({ id, data = {} }) => {
  const template = getTemplate(id);
  if (!template) return { ok: false, errors: ['template_not_found'] };

  const rendered = {
    subject: renderToken(template.subject, data),
    html: renderToken(template.html, data),
    text: template.text ? renderToken(template.text, data) : null
  };

  return {
    ok: true,
    mode: 'safe-template-preview',
    templateId: template.id,
    rendered,
    realDelivery: false
  };
};
