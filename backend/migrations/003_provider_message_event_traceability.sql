-- Add provider-message traceability for imported/dry-run email events without storing provider secrets

ALTER TABLE email_events
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS email_events_provider_message_id_idx
  ON email_events(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_events_provider_message_campaign_idx
  ON email_events(provider_message_id, campaign_id)
  WHERE provider_message_id IS NOT NULL;
