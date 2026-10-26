-- Keep the Ecount inventory-status classification on the isolated SaaS
-- inventory ledger so a downloaded full snapshot can preserve it.
ALTER TABLE saas_china_inventory
  ADD COLUMN IF NOT EXISTS item_category varchar(100);
