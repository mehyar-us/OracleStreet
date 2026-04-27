const INGEST_TYPES = new Set(['bounce', 'complaint']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeHeader = (value) => String(value || '').trim().toLowerCase();
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

export const validateEventImportCsv = ({ csv }) => {
  const cleanCsv = String(csv || '').trim();
  if (!cleanCsv) return { ok: false, error: 'csv_required' };

  const lines = cleanCsv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'csv_header_and_rows_required' };

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const requiredHeaders = ['type', 'email', 'source'];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) return { ok: false, error: 'required_headers_missing', missingHeaders };

  const accepted = [];
  const rejected = [];
  lines.slice(1).forEach((line, rowIndex) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    const type = normalizeHeader(row.type);
    const email = normalizeEmail(row.email);
    const source = String(row.source || '').trim();
    const errors = [];

    if (!INGEST_TYPES.has(type)) errors.push('valid_event_type_required');
    if (!EMAIL_RE.test(email)) errors.push('valid_email_required');
    if (!source) errors.push('source_required');

    const normalized = {
      type,
      email,
      source,
      detail: row.detail ? String(row.detail).slice(0, 500) : null,
      campaignId: row.campaignid || row.campaign_id || null,
      contactId: row.contactid || row.contact_id || null
    };

    if (errors.length > 0) rejected.push({ row: rowIndex + 2, email: email || null, errors });
    else accepted.push({ row: rowIndex + 2, event: normalized });
  });

  return {
    ok: rejected.length === 0,
    mode: 'manual-event-import-validate',
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted,
    rejected,
    realDelivery: false
  };
};
