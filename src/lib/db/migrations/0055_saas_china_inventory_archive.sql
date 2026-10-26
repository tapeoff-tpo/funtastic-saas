-- Inventory-status reports are authoritative snapshots of the default China
-- warehouse. Keep omitted rows for shipment and purchase audit relations,
-- while hiding them from the active SaaS inventory list.
ALTER TABLE saas_china_inventory
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS saas_china_inventory_user_active
  ON saas_china_inventory(user_id)
  WHERE archived_at IS NULL;
