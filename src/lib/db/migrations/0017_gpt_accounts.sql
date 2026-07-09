CREATE TABLE IF NOT EXISTS "gpt_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "email" varchar(255),
  "status" varchar(30) NOT NULL DEFAULT 'available',
  "current_user_name" varchar(100),
  "daily_reset_time" varchar(10),
  "weekly_reset_at" timestamp with time zone,
  "five_hour_limit" varchar(100),
  "weekly_limit" varchar(100),
  "notes" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "five_hour_limit" varchar(100);
ALTER TABLE "gpt_accounts" ADD COLUMN IF NOT EXISTS "weekly_limit" varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS "gpt_accounts_user_name_uniq"
ON "gpt_accounts" USING btree ("user_id", "name");

CREATE INDEX IF NOT EXISTS "gpt_accounts_user_sort_idx"
ON "gpt_accounts" USING btree ("user_id", "sort_order");

CREATE INDEX IF NOT EXISTS "gpt_accounts_user_status_idx"
ON "gpt_accounts" USING btree ("user_id", "status");

CREATE TABLE IF NOT EXISTS "gpt_account_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "gpt_accounts"("id") ON DELETE cascade,
  "author_name" varchar(100),
  "event_type" varchar(50) NOT NULL DEFAULT 'memo',
  "message" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "gpt_account_messages_account_created_idx"
ON "gpt_account_messages" USING btree ("account_id", "created_at");

CREATE INDEX IF NOT EXISTS "gpt_account_messages_user_created_idx"
ON "gpt_account_messages" USING btree ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "gpt_account_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "gpt_accounts"("id") ON DELETE cascade,
  "user_name" varchar(100) NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "status" varchar(30) NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS "gpt_account_sessions_account_started_idx"
ON "gpt_account_sessions" USING btree ("account_id", "started_at");

CREATE INDEX IF NOT EXISTS "gpt_account_sessions_user_status_idx"
ON "gpt_account_sessions" USING btree ("user_id", "status");

CREATE TABLE IF NOT EXISTS "gpt_account_waitlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "gpt_accounts"("id") ON DELETE cascade,
  "user_name" varchar(100) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'waiting',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "gpt_account_waitlist_account_status_idx"
ON "gpt_account_waitlist" USING btree ("account_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "gpt_account_waitlist_user_status_idx"
ON "gpt_account_waitlist" USING btree ("user_id", "status");
