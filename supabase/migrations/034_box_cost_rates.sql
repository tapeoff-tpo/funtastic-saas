CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS box_cost_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  package_name varchar(100) NOT NULL,
  unit_cost numeric(12, 2) NOT NULL,
  effective_from date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS box_cost_rates_user_package_effective_unique
  ON box_cost_rates(user_id, package_name, effective_from);

CREATE INDEX IF NOT EXISTS box_cost_rates_user_active_idx
  ON box_cost_rates(user_id, is_active);
