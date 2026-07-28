-- Keep the B2B product number as the source-sync key, but manage marketplace
-- registration and external marketplace matching with internal sales SKUs.
ALTER TABLE public.marketplace_registration_profiles
  ADD COLUMN IF NOT EXISTS sales_codes jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS marketplace_registration_profiles_sales_codes_gin
  ON public.marketplace_registration_profiles USING gin (sales_codes);
