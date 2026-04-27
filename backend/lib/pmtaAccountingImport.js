const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_RE = /\b[245]\.\d{1,3}\.\d{1,3}\b/;

const normalizeHeader = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const splitCsvLine = (line) => {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
};

const firstValue = (row, names) => {
  for (const name of names) {
    if (row[name]) return row[name];
  }
  return '';
};

const classify = ({ status, action }) => {
  const cleanAction = String(action || '').trim().toLowerCase();
  if (cleanAction === 'failed' || status?.startsWith('5.')) return 'bounce';
  if (cleanAction === 'delayed' || status?.startsWith('4.')) return 'deferred';
  if (cleanAction === 'delivered' || cleanAction === 'relayed' || status?.startsWith('2.')) return 'delivered';
  return null;
};

export const validatePowerMtaAccountingCsv = ({ csv, source = 'pmta_accounting_import' }) => {
  const cleanCsv = String(csv || '').trim();
  if (!cleanCsv) return { ok: false, error: 'csv_required' };
  if (cleanCsv.length > 100000) return { ok: false, error: 'csv_too_large' };

  const lines = cleanCsv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'csv_header_and_rows_required' };

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const recipientHeaders = ['recipient', 'rcpt', 'rcptto', 'email', 'originalrecipient', 'finalrecipient'];
  const statusHeaders = ['status', 'dsnstatus', 'dsn', 'enhancedstatus'];
  const missingHeaders = [];
  if (!headers.some((header) => recipientHeaders.includes(header))) missingHeaders.push('recipient');
  if (!headers.some((header) => statusHeaders.includes(header))) missingHeaders.push('status');
  if (missingHeaders.length > 0) return { ok: false, error: 'required_headers_missing', missingHeaders };

  const accepted = [];
  const rejected = [];
  lines.slice(1).forEach((line, rowIndex) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    const email = normalizeEmail(firstValue(row, recipientHeaders));
    const status = firstValue(row, statusHeaders).match(STATUS_RE)?.[0] || null;
    const action = firstValue(row, ['action', 'dsnaction', 'type', 'event']);
    const type = classify({ status, action });
    const detail = firstValue(row, ['diagnostic', 'diagnosticcode', 'diag', 'reason', 'description']);
    const errors = [];

    if (!EMAIL_RE.test(email)) errors.push('valid_recipient_required');
    if (!status) errors.push('valid_dsn_status_required');
    if (!type) errors.push('supported_delivery_status_required');

    const event = {
      type,
      email,
      source: String(source || 'pmta_accounting_import').trim() || 'pmta_accounting_import',
      detail: detail ? String(detail).slice(0, 500) : status,
      status,
      action: action ? String(action).trim() : null,
      campaignId: firstValue(row, ['campaignid', 'campaign']) || null,
      contactId: firstValue(row, ['contactid', 'contact']) || null,
      providerMessageId: firstValue(row, ['messageid', 'providermessageid', 'jobid', 'vmtaid']) || null
    };

    if (errors.length > 0) rejected.push({ row: rowIndex + 2, email: email || null, errors });
    else accepted.push({ row: rowIndex + 2, event });
  });

  return {
    ok: rejected.length === 0,
    mode: 'powermta-accounting-import-validate',
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted,
    rejected,
    safety: {
      validationOnly: true,
      noEventRecorded: true,
      noSuppressionCreated: true,
      noNetworkProbe: true,
      noMailboxConnection: true,
      realDelivery: false
    },
    realDelivery: false
  };
};
