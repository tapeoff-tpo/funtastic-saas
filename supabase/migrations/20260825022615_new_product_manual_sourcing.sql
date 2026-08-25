CREATE TABLE IF NOT EXISTS public.new_product_workflow_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  display_name varchar(100) NOT NULL,
  position integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT new_product_workflow_operators_position_check CHECK (position BETWEEN 1 AND 5),
  CONSTRAINT new_product_workflow_operators_workspace_member_unique UNIQUE (user_id, member_user_id)
);

CREATE INDEX IF NOT EXISTS new_product_workflow_operators_workspace_active_idx
  ON public.new_product_workflow_operators (user_id, is_active, position);

ALTER TABLE public.new_product_workflow_operators
  DROP CONSTRAINT IF EXISTS new_product_workflow_operators_user_id_position_key,
  DROP CONSTRAINT IF EXISTS new_product_workflow_operators_workspace_position_unique;

CREATE UNIQUE INDEX IF NOT EXISTS new_product_workflow_operators_workspace_active_position_unique
  ON public.new_product_workflow_operators (user_id, position)
  WHERE is_active = TRUE;

ALTER TABLE public.new_product_workflow_operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.new_product_workflow_operators FROM anon, authenticated;

ALTER TABLE IF EXISTS public.new_product_workflow_items
  ADD COLUMN IF NOT EXISTS owner_operator_id uuid,
  ADD COLUMN IF NOT EXISTS sourcing_item_id uuid,
  ADD COLUMN IF NOT EXISTS product_option text,
  ADD COLUMN IF NOT EXISTS china_unit_price_cny numeric(14, 2),
  ADD COLUMN IF NOT EXISTS unit_shipping_cny numeric(14, 2),
  ADD COLUMN IF NOT EXISTS exchange_rate_krw numeric(14, 4),
  ADD COLUMN IF NOT EXISTS calculated_cost_krw integer,
  ADD COLUMN IF NOT EXISTS domestic_sale_url text,
  ADD COLUMN IF NOT EXISTS domestic_sale_price integer,
  ADD COLUMN IF NOT EXISTS detail_page_url text,
  ADD COLUMN IF NOT EXISTS memo_1 text,
  ADD COLUMN IF NOT EXISTS memo_2 text;

CREATE INDEX IF NOT EXISTS new_product_workflow_items_workspace_owner_updated_idx
  ON public.new_product_workflow_items (user_id, owner_operator_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS new_product_workflow_items_workspace_sourcing_unique
  ON public.new_product_workflow_items (user_id, sourcing_item_id)
  WHERE sourcing_item_id IS NOT NULL;

ALTER TABLE IF EXISTS public.sourcing_items
  ADD COLUMN IF NOT EXISTS owner_operator_id uuid,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS product_option text,
  ADD COLUMN IF NOT EXISTS china_unit_price_cny numeric(14, 2),
  ADD COLUMN IF NOT EXISTS unit_shipping_cny numeric(14, 2),
  ADD COLUMN IF NOT EXISTS exchange_rate_krw numeric(14, 4),
  ADD COLUMN IF NOT EXISTS calculated_cost_krw integer,
  ADD COLUMN IF NOT EXISTS domestic_sale_url text,
  ADD COLUMN IF NOT EXISTS domestic_sale_price integer,
  ADD COLUMN IF NOT EXISTS detail_page_url text,
  ADD COLUMN IF NOT EXISTS memo_1 text,
  ADD COLUMN IF NOT EXISTS memo_2 text,
  ADD COLUMN IF NOT EXISTS passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS passed_new_product_id uuid,
  ADD COLUMN IF NOT EXISTS image_file_name text,
  ADD COLUMN IF NOT EXISTS image_content_type varchar(160),
  ADD COLUMN IF NOT EXISTS image_file_size integer,
  ADD COLUMN IF NOT EXISTS image_file_data bytea;

CREATE INDEX IF NOT EXISTS sourcing_items_workspace_owner_updated_idx
  ON public.sourcing_items (user_id, owner_operator_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sourcing_items_workspace_passed_new_product_unique
  ON public.sourcing_items (user_id, passed_new_product_id)
  WHERE passed_new_product_id IS NOT NULL;
