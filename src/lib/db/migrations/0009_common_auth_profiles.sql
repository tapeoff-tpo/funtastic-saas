CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS "common_auth_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "provider" varchar(50) DEFAULT 'naver_email' NOT NULL,
  "account_email" varchar(255) NOT NULL,
  "vault_secret_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "common_auth_profiles_user_provider_name"
  ON "common_auth_profiles" ("user_id", "provider", "name");

CREATE INDEX IF NOT EXISTS "common_auth_profiles_user_provider"
  ON "common_auth_profiles" ("user_id", "provider");
