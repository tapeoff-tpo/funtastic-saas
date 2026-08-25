ALTER TABLE public.new_product_workflow_items
  ADD COLUMN IF NOT EXISTS product_option text,
  ADD COLUMN IF NOT EXISTS china_unit_price_cny numeric(14, 2),
  ADD COLUMN IF NOT EXISTS exchange_rate_krw numeric(14, 4),
  ADD COLUMN IF NOT EXISTS calculated_cost_krw integer,
  ADD COLUMN IF NOT EXISTS sabangnet_code varchar(100),
  ADD COLUMN IF NOT EXISTS purchase_reference_notes text,
  ADD COLUMN IF NOT EXISTS previous_cost_krw integer,
  ADD COLUMN IF NOT EXISTS b2b_option_surcharge integer,
  ADD COLUMN IF NOT EXISTS b2c_option_surcharge integer,
  ADD COLUMN IF NOT EXISTS notice_material text,
  ADD COLUMN IF NOT EXISTS notice_size text,
  ADD COLUMN IF NOT EXISTS notice_manufacturer text,
  ADD COLUMN IF NOT EXISTS notice_weight text,
  ADD COLUMN IF NOT EXISTS notice_country text,
  ADD COLUMN IF NOT EXISTS notice_capacity text,
  ADD COLUMN IF NOT EXISTS notice_food_safety text,
  ADD COLUMN IF NOT EXISTS notice_components text,
  ADD COLUMN IF NOT EXISTS notice_special_notes text;

CREATE INDEX IF NOT EXISTS new_product_workflow_items_workspace_sabangnet_idx
  ON public.new_product_workflow_items(user_id, sabangnet_code)
  WHERE sabangnet_code IS NOT NULL;
