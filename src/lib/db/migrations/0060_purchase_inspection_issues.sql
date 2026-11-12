CREATE TABLE IF NOT EXISTS purchase_inspection_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  purchase_request_item_id uuid NOT NULL REFERENCES purchase_request_items(id) ON DELETE CASCADE,
  description text NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(description)) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_inspection_issues_user_item_created_idx
ON purchase_inspection_issues(user_id, purchase_request_item_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS purchase_inspection_issue_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  issue_id uuid NOT NULL REFERENCES purchase_inspection_issues(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type varchar(160) NOT NULL,
  file_size integer NOT NULL,
  file_data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (file_size > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_inspection_issue_attachments_issue_created_idx
ON purchase_inspection_issue_attachments(issue_id, created_at);
--> statement-breakpoint
ALTER TABLE purchase_inspection_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_inspection_issue_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE purchase_inspection_issues, purchase_inspection_issue_attachments FROM anon, authenticated;
