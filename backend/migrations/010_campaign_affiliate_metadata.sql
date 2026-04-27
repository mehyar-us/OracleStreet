-- Add safe affiliate/campaign metadata fields for dry-run campaign planning and reporting
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS affiliate_program text,
  ADD COLUMN IF NOT EXISTS affiliate_offer_id text,
  ADD COLUMN IF NOT EXISTS payout_model text,
  ADD COLUMN IF NOT EXISTS tracking_template text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS campaign_notes text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS campaigns_affiliate_program_idx ON campaigns(affiliate_program);
CREATE INDEX IF NOT EXISTS campaigns_affiliate_offer_id_idx ON campaigns(affiliate_offer_id);
