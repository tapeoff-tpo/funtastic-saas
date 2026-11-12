-- Independent authentication. Existing workspace/user UUIDs remain unchanged.
CREATE TABLE IF NOT EXISTS public.app_auth_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id),
  email text UNIQUE,
  password_hash text,
  approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'blocked')),
  approved_by uuid REFERENCES public.user_profiles(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.app_auth_identities (
  provider text NOT NULL CHECK (provider IN ('kakao')),
  provider_user_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.app_auth_accounts(user_id),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE TABLE IF NOT EXISTS public.app_auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_auth_accounts(user_id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_auth_sessions_user_idx ON public.app_auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS public.app_auth_password_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_auth_accounts(user_id),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- No client access policies: authentication tables are server-only.
CREATE TABLE IF NOT EXISTS public.app_auth_login_limits (
  email_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_auth_login_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_auth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_auth_password_tokens ENABLE ROW LEVEL SECURITY;
