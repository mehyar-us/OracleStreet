const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_CONSENT = new Set(['opt_in', 'double_opt_in']);

const contacts = new Map();
let sequence = 0;

const nowIso = () => new Date().toISOString();

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const resetContactsForTests = () => {
  contacts.clear();
  sequence = 0;
};

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

export const validateContactImport = (incomingContacts) => {
  if (!Array.isArray(incomingContacts)) {
    return { ok: false, error: 'contacts_array_required' };
  }

  const seen = new Set();
  const rows = incomingContacts.map((contact, index) => {
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

const materializeContact = (contact, actorEmail) => {
  const existing = contacts.get(contact.email);
  const id = existing?.id || `ct_${(++sequence).toString().padStart(6, '0')}`;
  const createdAt = existing?.createdAt || nowIso();
  const saved = {
    id,
    ...contact,
    status: 'active',
    actorEmail,
    createdAt,
    updatedAt: nowIso()
  };
  contacts.set(contact.email, saved);
  return { ...saved };
};

export const importContacts = (incomingContacts, actorEmail = null) => {
  const validation = validateContactImport(incomingContacts);
  if (validation.error) return validation;
  if (!validation.ok) return { ...validation, mode: 'import-rejected' };

  const imported = [];
  const updated = [];
  validation.accepted.forEach((contact) => {
    const existed = contacts.has(contact.email);
    const saved = materializeContact(contact, actorEmail);
    if (existed) updated.push(saved);
    else imported.push(saved);
  });

  return {
    ok: true,
    mode: 'in-memory-contact-import',
    importedCount: imported.length,
    updatedCount: updated.length,
    totalContacts: contacts.size,
    imported,
    updated,
    persistenceMode: 'in-memory-until-postgresql-connection-enabled'
  };
};

export const listContacts = () => ({
  ok: true,
  count: contacts.size,
  contacts: [...contacts.values()].map((contact) => ({ ...contact }))
});

export const getAllContacts = () => [...contacts.values()].map((contact) => ({ ...contact }));
