CREATE UNIQUE INDEX IF NOT EXISTS new_product_workflow_items_workspace_sample_code_unique
ON new_product_workflow_items(user_id, lower(btrim(sample_code)))
WHERE sample_code IS NOT NULL AND length(btrim(sample_code)) > 0;
