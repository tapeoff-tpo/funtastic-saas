CREATE TABLE IF NOT EXISTS new_product_workflow_preferences (
  user_id uuid PRIMARY KEY,
  editor_layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS new_product_workflow_items_user_updated_idx
ON new_product_workflow_items(user_id, updated_at DESC);

ALTER TABLE new_product_workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_product_workflow_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_product_workflow_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_product_workflow_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_product_workflow_preferences ENABLE ROW LEVEL SECURITY;
