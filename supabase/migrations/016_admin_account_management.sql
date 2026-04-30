-- Phase 9: Admin Account Management
-- user_profiles + audit_logs + RLS + cross-schema FK to auth.users + idempotent backfill

-- ─── Enums ───────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_admin', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM (
    'account.create',
    'account.role_change',
    'account.deactivate',
    'account.reactivate',
    'account.password_reset',
    'password.self_change'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── user_profiles ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL,
  role            user_role NOT NULL DEFAULT 'admin',
  display_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  deactivated_at  timestamptz,
  deactivated_by  uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_idx ON public.user_profiles (email);
CREATE INDEX IF NOT EXISTS user_profiles_role_idx ON public.user_profiles (role);
CREATE INDEX IF NOT EXISTS user_profiles_active_idx ON public.user_profiles (deactivated_at);

-- ─── audit_logs ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  action      audit_action NOT NULL,
  target_id   uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON public.audit_logs (actor_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON public.audit_logs (target_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (action, created_at);

-- ─── Helper: is_super_admin() ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_super_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = uid AND role = 'super_admin' AND deactivated_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, anon;

-- ─── Row Level Security ──────────────────────────────────────────

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs    ENABLE ROW LEVEL SECURITY;

-- user_profiles: read self or all-if-super_admin; write only via service_role (server actions)
DROP POLICY IF EXISTS "user_profiles_select_self_or_super" ON public.user_profiles;
CREATE POLICY "user_profiles_select_self_or_super" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "user_profiles_no_client_writes" ON public.user_profiles;
CREATE POLICY "user_profiles_no_client_writes" ON public.user_profiles
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
-- (service_role bypasses RLS — server actions write directly via admin client)

-- audit_logs: super_admin can read all, users can read entries about themselves
DROP POLICY IF EXISTS "audit_logs_select_super_or_target" ON public.audit_logs;
CREATE POLICY "audit_logs_select_super_or_target" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR target_id = auth.uid() OR actor_id = auth.uid());

DROP POLICY IF EXISTS "audit_logs_no_client_writes" ON public.audit_logs;
CREATE POLICY "audit_logs_no_client_writes" ON public.audit_logs
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── Backfill from auth.users (idempotent) ──────────────────────

INSERT INTO public.user_profiles (id, email, role, display_name)
SELECT
  u.id,
  u.email,
  COALESCE(
    (u.raw_app_meta_data->>'role')::user_role,
    'admin'::user_role
  ) AS role,
  u.raw_user_meta_data->>'display_name' AS display_name
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (id) DO NOTHING;
