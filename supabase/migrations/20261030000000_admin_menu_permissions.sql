-- Additive authorization storage. Missing row / NULL preserves existing access.
CREATE TABLE IF NOT EXISTS public.user_menu_permissions (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  allowed_menus jsonb,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_menu_permissions_array CHECK (
    allowed_menus IS NULL OR jsonb_typeof(allowed_menus) = 'array'
  )
);
-- Only trusted server DB connections manage permissions; no browser write policy.
ALTER TABLE public.user_menu_permissions ENABLE ROW LEVEL SECURITY;
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'account.menu_permissions_change';
