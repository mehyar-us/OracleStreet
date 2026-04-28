import { bounceMailboxReadiness } from './bounceMailboxReadiness.js';
import { senderDomainReadiness } from './domainReadiness.js';
import { getEmailProviderConfig, validateSelectedProviderConfig } from './emailProvider.js';
import { getRateLimitConfig } from './rateLimits.js';
import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const proofAuditRecords = [];
let proofAuditSequence = 0;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const maskEmail = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const [local, domain] = normalized.split('@');
  if (!domain) return 'configured';
  return `${local.slice(0, 2)}***@${domain}`;
};

const cloneProofAuditRecord = (record) => ({
  ...record,
  recipient: { ...record.recipient },
  safety: { ...record.safety }
});

const pgRowToProofAudit = ([id, outcome, recipientMasked, recipientOwned, matchesConfiguredRecipient, dryRunProofId, providerMessageId, notes, actorEmail, safetyJson, createdAt, realDeliveryAllowed]) => ({
  id,
  outcome,
  recipient: {
    email: recipientMasked,
    owned: recipientOwned === 't' || recipientOwned === 'true',
    matchesConfiguredRecipient: matchesConfiguredRecipient === 't' || matchesConfiguredRecipient === 'true'
  },
  dryRunProofId,
  providerMessageId: providerMessageId || null,
  notes: notes || null,
  actorEmail: actorEmail || null,
  createdAt,
  safety: safetyJson ? JSON.parse(safetyJson) : {},
  realDeliveryAllowed: realDeliveryAllowed === 't' || realDeliveryAllowed === 'true'
});

const listProofAuditsFromPostgres = () => runLocalPgRows(`
  SELECT id, outcome, recipient_masked, recipient_owned::text, matches_configured_recipient::text, dry_run_proof_id, coalesce(provider_message_id, ''), coalesce(notes, ''), coalesce(actor_email, ''), safety::text, created_at::text, real_delivery_allowed::text
  FROM controlled_live_test_proof_audits
  ORDER BY created_at DESC
  LIMIT 1000;
`).map(pgRowToProofAudit);

const saveProofAuditToPostgres = (record) => {
  const rows = runLocalPgRows(`
    INSERT INTO controlled_live_test_proof_audits (id, outcome, recipient_masked, recipient_owned, matches_configured_recipient, dry_run_proof_id, provider_message_id, notes, actor_email, safety, created_at, real_delivery_allowed)
    VALUES (${[
      sqlLiteral(record.id),
      sqlLiteral(record.outcome),
      sqlLiteral(record.recipient.email),
      record.recipient.owned ? 'true' : 'false',
      record.recipient.matchesConfiguredRecipient ? 'true' : 'false',
      sqlLiteral(record.dryRunProofId),
      sqlLiteral(record.providerMessageId),
      sqlLiteral(record.notes),
      sqlLiteral(record.actorEmail),
      `${sqlLiteral(JSON.stringify(record.safety))}::jsonb`,
      sqlLiteral(record.createdAt),
      'false'
    ].join(',')})
    RETURNING id, outcome, recipient_masked, recipient_owned::text, matches_configured_recipient::text, dry_run_proof_id, coalesce(provider_message_id, ''), coalesce(notes, ''), coalesce(actor_email, ''), safety::text, created_at::text, real_delivery_allowed::text;
  `);
  return pgRowToProofAudit(rows[0]);
};

export const controlledLiveTestReadiness = (env = process.env) => {
  const provider = getEmailProviderConfig(env);
  const providerValidation = validateSelectedProviderConfig(env);
  const domainReadiness = senderDomainReadiness(env);
  const bounceMailbox = bounceMailboxReadiness(env);
  const rateLimits = getRateLimitConfig(env);
  const recipient = normalizeEmail(env.ORACLESTREET_CONTROLLED_TEST_RECIPIENT_EMAIL);
  const recipientOwned = String(env.ORACLESTREET_CONTROLLED_TEST_RECIPIENT_OWNED || '').trim().toLowerCase() === 'true';
  const explicitApproval = String(env.ORACLESTREET_CONTROLLED_LIVE_TEST_APPROVED || '').trim().toLowerCase() === 'true';
  const blockers = [];

  if (['dry-run', 'local-capture'].includes(provider.provider)) blockers.push('live_provider_required_for_controlled_test');
  if (!providerValidation.ok) blockers.push('provider_config_invalid');
  if (!EMAIL_RE.test(recipient)) blockers.push('controlled_test_recipient_email_required');
  if (!recipientOwned) blockers.push('controlled_test_recipient_must_be_owned');
  if (!domainReadiness.ok) blockers.push('sender_domain_not_ready');
  if (!bounceMailbox.ok) blockers.push('bounce_mailbox_not_ready');
  if (rateLimits.globalPerWindow > 1 || rateLimits.perDomainPerWindow > 1) blockers.push('single_message_rate_limit_required');
  if (!explicitApproval) blockers.push('explicit_human_approval_required');

  return {
    ok: blockers.length === 0,
    mode: 'controlled-live-test-readiness-safe-gate',
    readyForControlledLiveTest: false,
    provider: {
      provider: provider.provider,
      sendMode: provider.sendMode,
      realSendingEnabled: provider.realSendingEnabled,
      realDeliveryAllowed: false
    },
    providerValidation,
    recipient: {
      configured: Boolean(recipient),
      email: maskEmail(recipient),
      owned: recipientOwned
    },
    rateLimits: {
      globalPerWindow: rateLimits.globalPerWindow,
      perDomainPerWindow: rateLimits.perDomainPerWindow,
      windowSeconds: rateLimits.windowSeconds,
      singleMessageRequired: true
    },
    domainReadiness,
    bounceMailboxReadiness: bounceMailbox,
    blockers,
    nextSafeStep: blockers.length > 0
      ? 'resolve_controlled_live_test_blockers_then_repeat_dry_run_and_local_capture_checks'
      : 'requires_manual_operator_run_for_one_owned_recipient_only',
    safety: {
      noSend: true,
      noNetworkProbe: true,
      noQueueMutation: true,
      noSuppressionMutation: true,
      noSecretOutput: true,
      maxMessagesIfLaterApproved: 1,
      requiresOwnedRecipient: true,
      requiresHumanApproval: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};

export const listControlledLiveTestProofAudits = () => {
  if (isPgRepositoryEnabled('controlled_live_test_proof_audits')) {
    try {
      const records = listProofAuditsFromPostgres();
      return {
        ok: true,
        mode: 'controlled-live-test-proof-audit-log',
        count: records.length,
        records: records.map(cloneProofAuditRecord),
        persistenceMode: 'postgresql-local-psql-repository',
        realDeliveryAllowed: false
      };
    } catch (error) {
      // Safe fallback keeps the audit log view available if the local psql adapter is unavailable.
    }
  }
  return {
    ok: true,
    mode: 'controlled-live-test-proof-audit-log',
    count: proofAuditRecords.length,
    records: proofAuditRecords.map(cloneProofAuditRecord),
    persistenceMode: isPgRepositoryEnabled('controlled_live_test_proof_audits') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled',
    realDeliveryAllowed: false
  };
};

export const planSeedInboxObservation = (env = process.env) => {
  const readiness = controlledLiveTestReadiness(env);
  const proofAudits = listControlledLiveTestProofAudits();
  const records = proofAudits.records || [];
  const outcomeCounts = records.reduce((counts, record) => ({ ...counts, [record.outcome]: (counts[record.outcome] || 0) + 1 }), {});
  const observed = records.filter((record) => ['delivered_observed', 'bounce_observed', 'complaint_observed'].includes(record.outcome));
  return {
    ok: true,
    mode: 'seed-inbox-observation-plan',
    observationMode: 'manual_out_of_band_only',
    readiness: {
      controlledLiveTestReady: false,
      blockers: readiness.blockers,
      provider: readiness.provider.provider,
      recipientConfigured: readiness.recipient.configured,
      recipientOwned: readiness.recipient.owned
    },
    counts: {
      proofAudits: records.length,
      observedOutcomes: observed.length,
      deliveredObserved: outcomeCounts.delivered_observed || 0,
      bounceObserved: outcomeCounts.bounce_observed || 0,
      complaintObserved: outcomeCounts.complaint_observed || 0,
      manualOneMessageSent: outcomeCounts.manual_one_message_sent || 0,
      blockedBeforeSend: outcomeCounts.blocked_before_send || 0,
      notSent: outcomeCounts.not_sent || 0
    },
    latestObservations: records.slice(0, 10).map((record) => ({
      id: record.id,
      outcome: record.outcome,
      recipient: record.recipient,
      dryRunProofId: record.dryRunProofId,
      providerMessageId: record.providerMessageId || null,
      createdAt: record.createdAt
    })),
    requiredManualObservationFields: [
      'seed_inbox_provider_or_mailbox_name_without_passwords',
      'observed_outcome_delivered_bounce_complaint_or_not_seen',
      'provider_message_id_if_manual_one_message_was_sent',
      'timestamp_and_headers_summary_without_secrets',
      'operator_notes_no_credentials_no_full_raw_message'
    ],
    nextSafeStep: records.length === 0
      ? 'record_dry_run_or_local_capture_proof_before_any_manual_seed_observation'
      : 'continue_manual_out_of_band_observation_and_record_results_in_proof_audit_only',
    safety: {
      noMailboxConnection: true,
      noInboxPolling: true,
      noNetworkProbe: true,
      noSend: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noSuppressionMutation: true,
      noSecretOutput: true,
      realDeliveryAllowed: false
    },
    persistenceMode: proofAudits.persistenceMode,
    realDeliveryAllowed: false
  };
};

export const recordControlledLiveTestProofAudit = ({ recipientEmail, dryRunProofId, providerMessageId, outcome = 'not_sent', notes = '', actorEmail } = {}, env = process.env) => {
  const configuredRecipient = normalizeEmail(env.ORACLESTREET_CONTROLLED_TEST_RECIPIENT_EMAIL);
  const requestedRecipient = normalizeEmail(recipientEmail || configuredRecipient);
  const cleanProofId = String(dryRunProofId || '').trim();
  const cleanProviderMessageId = String(providerMessageId || '').trim();
  const cleanOutcome = String(outcome || '').trim().toLowerCase();
  const allowedOutcomes = new Set(['not_sent', 'manual_one_message_sent', 'blocked_before_send', 'delivered_observed', 'bounce_observed', 'complaint_observed']);
  const errors = [];

  if (!EMAIL_RE.test(requestedRecipient)) errors.push('valid_owned_recipient_email_required');
  if (configuredRecipient && requestedRecipient !== configuredRecipient) errors.push('recipient_must_match_configured_controlled_test_recipient');
  if (!cleanProofId) errors.push('dry_run_or_local_capture_proof_id_required');
  if (!allowedOutcomes.has(cleanOutcome)) errors.push('valid_controlled_test_outcome_required');
  if (cleanOutcome === 'manual_one_message_sent' && !cleanProviderMessageId) errors.push('provider_message_id_required_for_manual_send_record');
  if (String(notes || '').length > 1000) errors.push('notes_max_1000_chars');

  if (errors.length > 0) {
    return {
      ok: false,
      mode: 'controlled-live-test-proof-audit-log',
      errors,
      recordMutation: false,
      sendMutation: false,
      realDeliveryAllowed: false
    };
  }

  const record = {
    id: `controlled_live_proof_${Date.now().toString(36)}_${(++proofAuditSequence).toString().padStart(6, '0')}`,
    outcome: cleanOutcome,
    recipient: {
      email: maskEmail(requestedRecipient),
      owned: String(env.ORACLESTREET_CONTROLLED_TEST_RECIPIENT_OWNED || '').trim().toLowerCase() === 'true',
      matchesConfiguredRecipient: configuredRecipient ? requestedRecipient === configuredRecipient : false
    },
    dryRunProofId: cleanProofId,
    providerMessageId: cleanProviderMessageId || null,
    notes: String(notes || '').trim() || null,
    actorEmail: actorEmail || null,
    createdAt: new Date().toISOString(),
    safety: {
      auditOnly: true,
      noSend: true,
      noNetworkProbe: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noSuppressionMutation: true,
      noSecretOutput: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
  let savedRecord = record;
  let persistenceMode = 'in-memory-until-postgresql-connection-enabled';
  if (isPgRepositoryEnabled('controlled_live_test_proof_audits')) {
    try {
      savedRecord = saveProofAuditToPostgres(record);
      persistenceMode = 'postgresql-local-psql-repository';
    } catch (error) {
      persistenceMode = 'postgresql-error-fallback-in-memory';
    }
  }
  proofAuditRecords.push(savedRecord);
  return { ok: true, mode: 'controlled-live-test-proof-audit-log', record: cloneProofAuditRecord(savedRecord), recordMutation: true, sendMutation: false, persistenceMode, realDeliveryAllowed: false };
};

export const resetControlledLiveTestProofAuditsForTests = () => {
  proofAuditRecords.length = 0;
  proofAuditSequence = 0;
};

export const planControlledLiveTest = ({ recipientEmail, approvalPhrase, dryRunProofId, actorEmail } = {}, env = process.env) => {
  const readiness = controlledLiveTestReadiness(env);
  const configuredRecipient = normalizeEmail(env.ORACLESTREET_CONTROLLED_TEST_RECIPIENT_EMAIL);
  const requestedRecipient = normalizeEmail(recipientEmail || configuredRecipient);
  const errors = [];
  const requiredApprovalPhrase = 'I_APPROVE_ONE_OWNED_RECIPIENT_LIVE_TEST';

  if (!EMAIL_RE.test(requestedRecipient)) errors.push('valid_owned_recipient_email_required');
  if (configuredRecipient && requestedRecipient !== configuredRecipient) errors.push('recipient_must_match_configured_controlled_test_recipient');
  if (approvalPhrase !== requiredApprovalPhrase) errors.push('exact_live_test_approval_phrase_required');
  if (!String(dryRunProofId || '').trim()) errors.push('dry_run_or_local_capture_proof_id_required');

  const acceptedForRunbook = errors.length === 0;
  const blockedByReadiness = readiness.blockers.length > 0;

  return {
    ok: acceptedForRunbook,
    mode: 'controlled-live-test-runbook-gate',
    acceptedForRunbook,
    readyForControlledLiveTest: false,
    blockedByReadiness,
    blockers: [...readiness.blockers, ...errors],
    requestedBy: actorEmail || null,
    recipient: {
      configured: Boolean(configuredRecipient),
      email: maskEmail(requestedRecipient),
      owned: readiness.recipient.owned,
      matchesConfiguredRecipient: configuredRecipient ? requestedRecipient === configuredRecipient : false
    },
    provider: readiness.provider,
    dryRunProof: {
      provided: Boolean(String(dryRunProofId || '').trim()),
      id: String(dryRunProofId || '').trim() || null
    },
    runbook: {
      purpose: 'single_owned_recipient_mta_proof_only',
      maxMessages: 1,
      prerequisites: [
        'provider_config_valid_and_redacted',
        'sender_domain_readiness_ok',
        'bounce_mailbox_readiness_ok',
        'rate_limits_set_to_one_message',
        'recipient_confirmed_owned',
        'dry_run_or_local_capture_proof_attached',
        'exact_human_approval_phrase_entered'
      ],
      manualSteps: [
        'repeat_provider_validation_and_controlled_live_readiness_checks',
        'confirm_recipient_is_owned_and_expecting_one_message',
        'send_exactly_one_message_only_after_out_of_band_human_approval',
        'record_provider_message_id_in_email_events',
        'watch_bounce_complaint_and_unsubscribe_feedback_before_any_next_step'
      ],
      rollback: [
        'set_ORACLESTREET_REAL_EMAIL_ENABLED_false',
        'return_ORACLESTREET_MAIL_PROVIDER_to_dry-run_or_local-capture',
        'keep_campaign_scale_delivery_locked'
      ]
    },
    safety: {
      noSend: true,
      noNetworkProbe: true,
      noQueueMutation: true,
      noProviderMutation: true,
      noSuppressionMutation: true,
      noSecretOutput: true,
      requiresSeparateManualExecution: true,
      realDeliveryAllowed: false
    },
    realDeliveryAllowed: false
  };
};
