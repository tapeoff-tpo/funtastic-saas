/**
 * Creates the isolated SaaS China inventory and outbound-workflow tables.
 *
 * This intentionally runs separately from the Ecount/raw-data inventory
 * tables so it can be applied before the new workflow is enabled.
 */
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL이 필요합니다.')
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false })
const requiredTables = [
  'saas_china_inventory',
  'saas_china_inventory_movements',
  'china_outbound_shipments',
  'china_outbound_shipment_items',
  'china_outbound_pallets',
  'china_outbound_boxes',
  'china_outbound_box_items',
]

const requiredConstraints = [
  ['saas_china_inventory', 'saas_china_inventory_id_user_key'],
  ['saas_china_inventory_movements', 'saas_china_inventory_movements_inventory_workspace_fkey'],
  ['china_outbound_shipments', 'china_outbound_shipments_id_user_key'],
  ['china_outbound_shipment_items', 'china_outbound_shipment_items_id_shipment_user_key'],
  ['china_outbound_shipment_items', 'china_outbound_shipment_items_shipment_workspace_fkey'],
  ['china_outbound_shipment_items', 'china_outbound_shipment_items_inventory_workspace_fkey'],
  ['china_outbound_pallets', 'china_outbound_pallets_id_shipment_user_key'],
  ['china_outbound_pallets', 'china_outbound_pallets_shipment_workspace_fkey'],
  ['china_outbound_boxes', 'china_outbound_boxes_id_shipment_user_key'],
  ['china_outbound_boxes', 'china_outbound_boxes_shipment_workspace_fkey'],
  ['china_outbound_boxes', 'china_outbound_boxes_pallet_shipment_workspace_fkey'],
  ['china_outbound_box_items', 'china_outbound_box_items_box_shipment_workspace_fkey'],
  ['china_outbound_box_items', 'china_outbound_box_items_shipment_item_workspace_fkey'],
]

try {
  const migration = await readFile(
    new URL('../supabase/migrations/20260916000000_saas_china_outbound.sql', import.meta.url),
    'utf8',
  )
  await sql.unsafe(migration)

  const tables = await sql`
    SELECT table_name, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
      AND table_name = ANY(${requiredTables})
    ORDER BY table_name
  `
  const found = new Set(tables.map((table) => table.table_name))
  const missing = requiredTables.filter((table) => !found.has(table))
  if (missing.length > 0) {
    throw new Error(`마이그레이션 후 테이블을 찾지 못했습니다: ${missing.join(', ')}`)
  }
  const withoutRls = tables
    .filter((table) => !table.rowsecurity)
    .map((table) => table.table_name)
  if (withoutRls.length > 0) {
    throw new Error(`RLS가 켜지지 않은 테이블이 있습니다: ${withoutRls.join(', ')}`)
  }

  const constraintNames = requiredConstraints.map(([, name]) => name)
  const constraints = await sql`
    SELECT rel.relname AS table_name, con.conname
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = rel.relnamespace
    WHERE namespace.nspname = 'public'
      AND con.conname = ANY(${constraintNames})
  `
  const foundConstraints = new Set(
    constraints.map((constraint) => `${constraint.table_name}:${constraint.conname}`),
  )
  const missingConstraints = requiredConstraints
    .map(([table, name]) => `${table}:${name}`)
    .filter((key) => !foundConstraints.has(key))
  if (missingConstraints.length > 0) {
    throw new Error(`출고 관계 제약을 찾지 못했습니다: ${missingConstraints.join(', ')}`)
  }

  const [boxItemShipmentColumn] = await sql`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'china_outbound_box_items'
      AND column_name = 'shipment_id'
  `
  if (boxItemShipmentColumn?.is_nullable !== 'NO') {
    throw new Error('china_outbound_box_items.shipment_id가 NOT NULL이 아닙니다.')
  }

  console.log(`OK — SaaS 중국재고·출고 테이블 ${requiredTables.length}개, RLS, 관계 제약을 확인했습니다.`)
} catch (error) {
  console.error('ERR:', error)
  process.exitCode = 1
} finally {
  await sql.end()
}
