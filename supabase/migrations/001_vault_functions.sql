-- Enable Vault extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vault WITH SCHEMA vault;

-- Store a marketplace credential
CREATE OR REPLACE FUNCTION store_marketplace_credential(
  p_name TEXT,
  p_secret TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  secret_id UUID;
BEGIN
  SELECT vault.create_secret(p_secret, p_name, p_description) INTO secret_id;
  RETURN secret_id;
END;
$$;

-- Read a marketplace credential (returns decrypted value)
CREATE OR REPLACE FUNCTION read_marketplace_credential(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result TEXT;
BEGIN
  SELECT decrypted_secret INTO result
  FROM vault.decrypted_secrets
  WHERE name = p_name;
  RETURN result;
END;
$$;

-- Delete a marketplace credential
CREATE OR REPLACE FUNCTION delete_marketplace_credential(p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = p_name;
END;
$$;

-- Update an existing credential
CREATE OR REPLACE FUNCTION update_marketplace_credential(
  p_name TEXT,
  p_secret TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE vault.secrets
  SET secret = p_secret, updated_at = now()
  WHERE name = p_name;
END;
$$;

-- Restrict all functions to service_role only
REVOKE ALL ON FUNCTION store_marketplace_credential FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_marketplace_credential TO service_role;

REVOKE ALL ON FUNCTION read_marketplace_credential FROM PUBLIC;
GRANT EXECUTE ON FUNCTION read_marketplace_credential TO service_role;

REVOKE ALL ON FUNCTION delete_marketplace_credential FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_marketplace_credential TO service_role;

REVOKE ALL ON FUNCTION update_marketplace_credential FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_marketplace_credential TO service_role;
