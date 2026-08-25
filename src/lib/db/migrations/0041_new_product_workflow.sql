CREATE TABLE IF NOT EXISTS new_product_workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name varchar(160) NOT NULL,
  position integer NOT NULL,
  tone varchar(30) NOT NULL DEFAULT 'slate',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS new_product_workflow_stages_user_position_idx
ON new_product_workflow_stages(user_id, position);

CREATE TABLE IF NOT EXISTS new_product_workflow_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_number integer NOT NULL,
  stage_id uuid NOT NULL REFERENCES new_product_workflow_stages(id),
  sample_code varchar(200),
  product_name text NOT NULL,
  english_name text,
  source_url text,
  required_checks text,
  estimated_cost numeric(14, 2),
  history_notes text,
  reference_notes text,
  china_item_name text,
  planned_sale_date date,
  detail_page_due_date date,
  registered_product_name text,
  package_info_url text,
  package_progress_status varchar(100),
  package_status varchar(100),
  korean_manual_status varchar(100),
  declared_value numeric(14, 2),
  b2b_price integer,
  b2c_price integer,
  carrier varchar(100),
  b2b_shipping_fee integer,
  b2c_shipping_fee integer,
  quality_notice_status varchar(100),
  package_box_design varchar(100),
  package_manufacturer varchar(100),
  package_packing varchar(100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_number)
);

CREATE INDEX IF NOT EXISTS new_product_workflow_items_user_stage_idx
ON new_product_workflow_items(user_id, stage_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS new_product_workflow_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES new_product_workflow_items(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES new_product_workflow_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES new_product_workflow_stages(id),
  note text,
  changed_by_user_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS new_product_workflow_history_item_changed_idx
ON new_product_workflow_stage_history(item_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS new_product_workflow_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES new_product_workflow_items(id) ON DELETE CASCADE,
  kind varchar(40) NOT NULL,
  file_name text NOT NULL,
  content_type varchar(160) NOT NULL,
  file_size integer NOT NULL,
  file_data bytea NOT NULL,
  uploaded_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('product_image', 'sample_china_image', 'final_sample_image', 'quality_pdf'))
);

CREATE INDEX IF NOT EXISTS new_product_workflow_attachments_item_kind_idx
ON new_product_workflow_attachments(item_id, kind, created_at);
