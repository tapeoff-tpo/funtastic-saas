ALTER TABLE "gpt_accounts"
ADD COLUMN IF NOT EXISTS "daily_limit" varchar(100),
ADD COLUMN IF NOT EXISTS "daily_reset_time" varchar(10);
