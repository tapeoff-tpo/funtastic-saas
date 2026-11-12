-- Internal registration work is shared through the canonical workspace owner.
-- Browser access goes through authenticated, menu-scoped server routes only.
CREATE TABLE IF NOT EXISTS coupang_registration_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  payload jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupang_registration_drafts_workspace
  ON coupang_registration_drafts (user_id, updated_at DESC);
ALTER TABLE coupang_registration_drafts ENABLE ROW LEVEL SECURITY;
