import { sql, type SQL } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { saasChinaInventory, saasChinaOutboundWarehouses, saasChinaInventoryMovements, chinaOutboundShipments, chinaOutboundShipmentItems, chinaOutboundPallets, chinaOutboundBoxes, chinaOutboundBoxItems, saasChinaPurchaseLinks, saasChinaShipmentPurchaseAllocations } from '@/lib/db/schema'

const tables = [saasChinaInventory, saasChinaOutboundWarehouses, saasChinaInventoryMovements, chinaOutboundShipments, chinaOutboundShipmentItems, chinaOutboundPallets, chinaOutboundBoxes, chinaOutboundBoxItems, saasChinaPurchaseLinks, saasChinaShipmentPurchaseAllocations].map((table) => {
  const config = getTableConfig(table)
  return { name: config.name, columns: config.columns.map((column) => ({ name: column.name, notNull: column.notNull })), foreignKeys: config.foreignKeys.length, checks: config.checks.length }
})
const indexes = [
  "saas_china_inventory_user_warehouse_sku_option_active",
  "saas_china_inventory_user_sku",
  "saas_china_inventory_user_warehouse_available",
  "saas_china_inventory_user_active",
  "saas_china_outbound_warehouses_user_default",
  "saas_china_outbound_warehouses_user_updated",
  "purchase_request_items_id_user",
  "saas_china_inventory_movements_user_source_key",
  "saas_china_inventory_movements_inventory_occurred",
  "saas_china_inventory_movements_user_occurred",
  "china_outbound_shipments_user_shipment_no",
  "china_outbound_shipments_user_status_created",
  "china_outbound_shipments_user_planned_outbound",
  "china_outbound_shipment_items_shipment_inventory",
  "china_outbound_shipment_items_inventory",
  "china_outbound_shipment_items_user_inventory",
  "china_outbound_shipment_items_shipment_sort",
  "china_outbound_pallets_shipment_pallet_no",
  "china_outbound_pallets_shipment_sort",
  "china_outbound_pallets_user_shipment",
  "china_outbound_boxes_shipment_box_no",
  "china_outbound_boxes_shipment_sort",
  "china_outbound_boxes_user_shipment",
  "china_outbound_boxes_pallet",
  "china_outbound_box_items_box_shipment_item",
  "china_outbound_box_items_shipment_item",
  "china_outbound_box_items_shipment_user",
  "saas_china_purchase_links_user_purchase_item",
  "saas_china_purchase_links_user_inventory_created",
  "saas_china_shipment_purchase_allocations_item_link",
  "saas_china_shipment_purchase_allocations_user_shipment",
  "saas_china_shipment_purchase_allocations_purchase_link"
]

// Metadata reads do not acquire the table locks taken by ALTER/CREATE/REVOKE.
export const chinaOutboundSchemaProbe = sql`
  WITH required AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(tables)}::jsonb) AS t(name text, columns jsonb, "foreignKeys" int, checks int)
  )
  SELECT NOT EXISTS (
    SELECT 1 FROM required
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = required.name AND c.relrowsecurity
        AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND (SELECT count(*) FROM pg_constraint p WHERE p.conrelid = c.oid AND p.contype = 'f' AND p.convalidated) >= required."foreignKeys"
        AND (SELECT count(*) FROM pg_constraint p WHERE p.conrelid = c.oid AND p.contype = 'c' AND p.convalidated) >= required.checks
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_to_recordset(required.columns) AS expected(name text, "notNull" boolean)
          WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = expected.name AND a.attnum > 0 AND NOT a.attisdropped AND (NOT expected."notNull" OR a.attnotnull))
        )
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(indexes)}::jsonb) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_index i ON i.indexrelid = c.oid
      WHERE n.nspname = current_schema() AND c.relname = expected.name AND i.indisvalid)
  ) AND to_regclass(current_schema() || '.saas_china_inventory_user_warehouse_sku_option') IS NULL AS ready
`

export function createChinaOutboundSchemaInitializer(execute: (query: SQL) => Promise<unknown>, bootstrap: SQL) {
  let pending: Promise<void> | null = null
  return () => pending ??= (async () => {
    const result = await execute(chinaOutboundSchemaProbe)
    const rows = Array.isArray(result) ? result : (result as { rows?: Array<{ ready: boolean }> } | undefined)?.rows
    if (rows?.[0]?.ready !== true) await execute(bootstrap)
  })().catch((error) => { pending = null; throw error })
}
