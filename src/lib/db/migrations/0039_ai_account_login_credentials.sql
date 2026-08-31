ALTER TABLE "gpt_accounts"
ADD COLUMN IF NOT EXISTS "login_method" varchar(50),
ADD COLUMN IF NOT EXISTS "login_id" varchar(255);
