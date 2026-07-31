CREATE TABLE IF NOT EXISTS figma_bridge_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  figma_file_key varchar(120) NOT NULL,
  command_type varchar(40) NOT NULL,
  target_frame_name text NOT NULL,
  target_node_name text NOT NULL,
  image_url text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'queued',
  error_message text,
  claimed_by_device_id uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS figma_bridge_commands_file_status_created_idx
  ON figma_bridge_commands (figma_file_key, status, created_at);
CREATE INDEX IF NOT EXISTS figma_bridge_commands_user_created_idx
  ON figma_bridge_commands (user_id, created_at);

ALTER TABLE figma_bridge_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE figma_bridge_commands FROM anon, authenticated;
