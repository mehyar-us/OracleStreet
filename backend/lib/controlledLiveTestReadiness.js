import { bounceMailboxReadiness } from './bounceMailboxReadiness.js';
import { senderDomainReadiness } from './domainReadiness.js';
import { getEmailProviderConfig, validateSelectedProviderConfig } from './emailProvider.js';
import { getRateLimitConfig } from './rateLimits.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const maskEmail = (email) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const [local, domain] = normalized.split('@');
  if (!domain) return 'configured';
  return `${local.slice(0, 2)}***@${domain}`;
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
