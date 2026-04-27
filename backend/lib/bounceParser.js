const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const STATUS_RE = /\b[245]\.\d{1,3}\.\d{1,3}\b/;

const normalizeEmail = (value) => String(value || '').trim().replace(/^<|>$/g, '').toLowerCase();
const cleanLine = (value) => String(value || '').trim();

const parseRecipient = (lines) => {
  const recipientLine = lines.find((line) => /^final-recipient:/i.test(line))
    || lines.find((line) => /^original-recipient:/i.test(line))
    || lines.find((line) => /^to:/i.test(line));
  if (!recipientLine) return null;
  const candidate = recipientLine.split(';').pop().replace(/^to:/i, '').trim();
  const match = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? normalizeEmail(match[0]) : null;
};

const parseStatus = (lines) => {
  const statusLine = lines.find((line) => /^status:/i.test(line));
  const diagnosticLine = lines.find((line) => /^diagnostic-code:/i.test(line));
  const status = statusLine?.match(STATUS_RE)?.[0] || diagnosticLine?.match(STATUS_RE)?.[0] || null;
  return status;
};

const eventTypeFromStatus = (status, action) => {
  const cleanAction = String(action || '').toLowerCase();
  if (cleanAction === 'failed') return 'bounce';
  if (cleanAction === 'delayed') return 'deferred';
  if (status?.startsWith('5.')) return 'bounce';
  if (status?.startsWith('4.')) return 'deferred';
  return null;
};

export const validateBounceMessage = ({ message, source = 'manual_bounce_parse', campaignId = null, contactId = null }) => {
  const raw = String(message || '').trim();
  if (!raw) return { ok: false, error: 'message_required' };
  if (raw.length > 20000) return { ok: false, error: 'message_too_large' };

  const lines = raw.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const recipient = parseRecipient(lines);
  const status = parseStatus(lines);
  const action = lines.find((line) => /^action:/i.test(line))?.split(':').slice(1).join(':').trim() || null;
  const diagnostic = lines.find((line) => /^diagnostic-code:/i.test(line))?.split(':').slice(1).join(':').trim().slice(0, 500) || null;
  const eventType = eventTypeFromStatus(status, action);
  const errors = [];

  if (!recipient || !EMAIL_RE.test(recipient)) errors.push('recipient_email_required');
  if (!eventType) errors.push('supported_bounce_or_deferral_status_required');

  return {
    ok: errors.length === 0,
    mode: 'manual-bounce-parse-validate',
    parsed: {
      type: eventType,
      email: recipient,
      source: String(source || 'manual_bounce_parse').trim() || 'manual_bounce_parse',
      detail: diagnostic || status || action || null,
      status,
      action,
      campaignId: campaignId ? String(campaignId).trim() : null,
      contactId: contactId ? String(contactId).trim() : null
    },
    errors,
    safety: {
      validationOnly: true,
      noEventRecorded: true,
      noSuppressionCreated: true,
      noNetworkProbe: true,
      realDelivery: false
    },
    realDelivery: false
  };
};
