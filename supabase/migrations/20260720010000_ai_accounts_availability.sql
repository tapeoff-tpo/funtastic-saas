ALTER TABLE "gpt_accounts"
ADD COLUMN IF NOT EXISTS "reset_available_count" integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "shared_use" boolean NOT NULL DEFAULT false;
