const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_CONSENT = new Set(['opt_in', 'double_opt_in']);

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const validateContact = (contact = {}, index = 0) => {
  const errors = [];
  const email = normalizeEmail(contact.email);
  const consentStatus = String(contact.consentStatus || contact.consent_status || '').trim();
  const source = String(contact.source || '').trim();

  if (!email || !EMAIL_RE.test(email)) errors.push('valid_email_required');
  if (!ALLOWED_CONSENT.has(consentStatus)) errors.push('explicit_consent_required');
  if (!source) errors.push('source_required');

  return {
    index,
    valid: errors.length === 0,
    errors,
    contact: {
      email,
      consentStatus,
      source,
      sourceDetail: String(contact.sourceDetail || contact.source_detail || '').trim() || null,
      firstName: String(contact.firstName || contact.first_name || '').trim() || null,
      lastName: String(contact.lastName || contact.last_name || '').trim() || null
    }
  };
};

export const validateContactImport = (contacts) => {
  if (!Array.isArray(contacts)) {
    return { ok: false, error: 'contacts_array_required' };
  }

  const seen = new Set();
  const rows = contacts.map((contact, index) => {
    const row = validateContact(contact, index);
    if (row.contact.email) {
      if (seen.has(row.contact.email)) {
        row.valid = false;
        row.errors.push('duplicate_email_in_import');
      }
      seen.add(row.contact.email);
    }
    return row;
  });

  const accepted = rows.filter((row) => row.valid);
  const rejected = rows.filter((row) => !row.valid);

  return {
    ok: rejected.length === 0,
    mode: 'validate-only',
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted: accepted.map((row) => row.contact),
    rejected: rejected.map(({ index, errors, contact }) => ({ index, email: contact.email || null, errors }))
  };
};
