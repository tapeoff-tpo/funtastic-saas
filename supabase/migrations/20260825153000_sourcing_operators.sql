CREATE TABLE IF NOT EXISTS public.sourcing_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  display_name varchar(100) NOT NULL,
  position integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_operators_workspace_member_unique UNIQUE (user_id, member_user_id)
);

CREATE INDEX IF NOT EXISTS sourcing_operators_workspace_active_idx
  ON public.sourcing_operators(user_id, is_active, position);

CREATE UNIQUE INDEX IF NOT EXISTS sourcing_operators_workspace_active_position_unique
  ON public.sourcing_operators(user_id, position)
  WHERE is_active = TRUE;

ALTER TABLE public.sourcing_operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sourcing_operators FROM anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.new_product_workflow_operators') IS NOT NULL THEN
    INSERT INTO public.sourcing_operators (
      id,
      user_id,
      member_user_id,
      display_name,
      position,
      is_active,
      created_at,
      updated_at
    )
    SELECT
      id,
      user_id,
      member_user_id,
      display_name,
      position,
      is_active,
      created_at,
      updated_at
    FROM public.new_product_workflow_operators
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
