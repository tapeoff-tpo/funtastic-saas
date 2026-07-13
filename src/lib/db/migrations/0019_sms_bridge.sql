CREATE TABLE IF NOT EXISTS "sms_bridge_pairings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" uuid REFERENCES "gpt_accounts"("id") ON DELETE set null,
  "device_label" varchar(100),
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "claimed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sms_bridge_pairings_token_hash_uniq" ON "sms_bridge_pairings" ("token_hash");
CREATE INDEX IF NOT EXISTS "sms_bridge_pairings_user_expires_idx" ON "sms_bridge_pairings" ("user_id", "expires_at");

CREATE TABLE IF NOT EXISTS "sms_bridge_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" uuid REFERENCES "gpt_accounts"("id") ON DELETE set null,
  "name" varchar(100) NOT NULL,
  "phone_label" varchar(100),
  "token_hash" varchar(64) NOT NULL,
  "app_version" varchar(30),
  "platform" varchar(30) DEFAULT 'android' NOT NULL,
  "last_seen_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sms_bridge_devices_token_hash_uniq" ON "sms_bridge_devices" ("token_hash");
CREATE INDEX IF NOT EXISTS "sms_bridge_devices_user_idx" ON "sms_bridge_devices" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "sms_bridge_devices_account_idx" ON "sms_bridge_devices" ("account_id");

CREATE TABLE IF NOT EXISTS "sms_bridge_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "sms_bridge_devices"("id") ON DELETE cascade,
  "account_id" uuid REFERENCES "gpt_accounts"("id") ON DELETE set null,
  "provider" varchar(30) DEFAULT 'pickleplus' NOT NULL,
  "sender" varchar(100),
  "body" text NOT NULL,
  "verification_code" varchar(12),
  "dedupe_hash" varchar(64) NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "sms_bridge_messages_dedupe_hash_uniq" ON "sms_bridge_messages" ("dedupe_hash");
CREATE INDEX IF NOT EXISTS "sms_bridge_messages_user_received_idx" ON "sms_bridge_messages" ("user_id", "received_at");
CREATE INDEX IF NOT EXISTS "sms_bridge_messages_account_received_idx" ON "sms_bridge_messages" ("account_id", "received_at");

ALTER TABLE "sms_bridge_pairings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_bridge_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_bridge_messages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "sms_bridge_pairings" FROM anon, authenticated;
REVOKE ALL ON TABLE "sms_bridge_devices" FROM anon, authenticated;
REVOKE ALL ON TABLE "sms_bridge_messages" FROM anon, authenticated;
