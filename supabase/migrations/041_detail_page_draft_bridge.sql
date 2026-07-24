CREATE TABLE IF NOT EXISTS detail_page_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  client_job_key varchar(160) NOT NULL,
  product_id varchar(120) NOT NULL,
  sku varchar(100) NOT NULL,
  product_name text NOT NULL,
  option_name text,
  purchase_url text,
  product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  template varchar(120) NOT NULL DEFAULT '기본 상품 상세',
  note text,
  status varchar(30) NOT NULL DEFAULT 'queued',
  error_message text,
  figma_file_key varchar(120) NOT NULL,
  figma_node_id varchar(120),
  figma_url text,
  claimed_by_device_id uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS detail_page_jobs_user_client_key_uniq ON detail_page_jobs (user_id, client_job_key);
CREATE INDEX IF NOT EXISTS detail_page_jobs_user_status_created_idx ON detail_page_jobs (user_id, status, created_at);
CREATE INDEX IF NOT EXISTS detail_page_jobs_file_status_created_idx ON detail_page_jobs (figma_file_key, status, created_at);

CREATE TABLE IF NOT EXISTS figma_bridge_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_label varchar(100),
  token_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS figma_bridge_pairings_token_hash_uniq ON figma_bridge_pairings (token_hash);
CREATE INDEX IF NOT EXISTS figma_bridge_pairings_user_expires_idx ON figma_bridge_pairings (user_id, expires_at);

CREATE TABLE IF NOT EXISTS figma_bridge_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  figma_file_key varchar(120) NOT NULL,
  token_hash varchar(64) NOT NULL,
  plugin_version varchar(30),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS figma_bridge_devices_token_hash_uniq ON figma_bridge_devices (token_hash);
CREATE INDEX IF NOT EXISTS figma_bridge_devices_user_created_idx ON figma_bridge_devices (user_id, created_at);
CREATE INDEX IF NOT EXISTS figma_bridge_devices_user_file_idx ON figma_bridge_devices (user_id, figma_file_key);

ALTER TABLE detail_page_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE figma_bridge_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE figma_bridge_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE detail_page_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE figma_bridge_pairings FROM anon, authenticated;
REVOKE ALL ON TABLE figma_bridge_devices FROM anon, authenticated;
