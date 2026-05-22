CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.common_auth_profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  provider varchar(50) NOT NULL DEFAULT 'naver_email',
  account_email varchar(255) NOT NULL,
  vault_secret_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS common_auth_profiles_user_provider_name
  ON public.common_auth_profiles (user_id, provider, name);

CREATE INDEX IF NOT EXISTS common_auth_profiles_user_provider
  ON public.common_auth_profiles (user_id, provider);
