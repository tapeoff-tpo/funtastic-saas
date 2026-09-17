import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaOutboundBoxItems,
  chinaOutboundBoxes,
  chinaOutboundPallets,
  chinaOutboundShipmentItems,
  chinaOutboundShipments,
  saasChinaInventory,
  saasChinaInventoryMovements,
} from '@/lib/db/schema'

/**
 * This is intentionally a separate operational ledger from Ecount's China
 * inventory snapshot. Do not join or write to `china_warehouse_inventory`
 * from this module: raw-data refreshes replace that table in full.
 */

export const CHINA_OUTBOUND_SHIPMENT_STATUSES = [
  'draft',
  'packing',
  'ready',
  'dispatched',
  'cancelled',
] as const

export type ChinaOutboundShipmentStatus = (typeof CHINA_OUTBOUND_SHIPMENT_STATUSES)[number]

export const CHINA_OUTBOUND_SHIPMENT_STATUS_LABELS: Record<ChinaOutboundShipmentStatus, string> = {
  draft: '초안',
  packing: '포장중',
  ready: '포장완료',
  dispatched: '출고완료',
  cancelled: '취소',
}

export type SaasChinaInventoryInput = {
  userId: string
  createdBy: string
  warehouseCode: string
  sku: string
  productName: string
  optionName?: string | null
  quantity: number
  note?: string | null
}

export type SaasChinaInventoryAdjustmentInput = {
  userId: string
  createdBy: string
  inventoryId: string
  delta: number
  note?: string | null
}

export type ChinaOutboundShipmentLineInput = {
  inventoryId: string
  quantity: number
}

export type CreateChinaOutboundShipmentInput = {
  userId: string
  createdBy: string
  shipmentNo?: string | null
  destinationName?: string | null
  destinationAddress?: string | null
  forwarderName?: string | null
  externalReference?: string | null
  plannedOutboundDate?: string | null
  memo?: string | null
  lines: ChinaOutboundShipmentLineInput[]
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ChinaOutboundShipmentItemRow = typeof chinaOutboundShipmentItems.$inferSelect

const EDITABLE_SHIPMENT_STATUSES: ChinaOutboundShipmentStatus[] = ['draft', 'packing']

// Production deployments in this project do not automatically run every SQL
// migration. Keep the formal migration files, and also bootstrap only these
// isolated tables on first use so the new screens never touch or depend on the
// replaceable Ecount/raw-data China inventory tables.
const SAAS_CHINA_OUTBOUND_SCHEMA_SQL = sql`
  CREATE TABLE IF NOT EXISTS saas_china_inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    warehouse_code varchar(100) NOT NULL DEFAULT 'default',
    sku varchar(100) NOT NULL,
    product_name text NOT NULL,
    option_key varchar(200) NOT NULL DEFAULT '',
    option_name varchar(200),
    on_hand_quantity integer NOT NULL DEFAULT 0,
    reserved_quantity integer NOT NULL DEFAULT 0,
    available_quantity integer NOT NULL DEFAULT 0,
    last_received_at timestamptz,
    last_outbound_at timestamptz,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT saas_china_inventory_id_user_key UNIQUE (id, user_id),
    CONSTRAINT saas_china_inventory_on_hand_nonnegative CHECK (on_hand_quantity >= 0),
    CONSTRAINT saas_china_inventory_reserved_nonnegative CHECK (reserved_quantity >= 0),
    CONSTRAINT saas_china_inventory_available_nonnegative CHECK (available_quantity >= 0),
    CONSTRAINT saas_china_inventory_available_matches_balance
      CHECK (available_quantity = on_hand_quantity - reserved_quantity)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS saas_china_inventory_user_warehouse_sku_option
    ON saas_china_inventory(user_id, warehouse_code, sku, option_key);
  CREATE INDEX IF NOT EXISTS saas_china_inventory_user_sku
    ON saas_china_inventory(user_id, sku);
  CREATE INDEX IF NOT EXISTS saas_china_inventory_user_warehouse_available
    ON saas_china_inventory(user_id, warehouse_code, sku)
    WHERE available_quantity > 0;

  CREATE TABLE IF NOT EXISTS saas_china_inventory_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id uuid NOT NULL,
    user_id uuid NOT NULL,
    movement_type varchar(40) NOT NULL,
    on_hand_delta integer NOT NULL DEFAULT 0,
    reserved_delta integer NOT NULL DEFAULT 0,
    on_hand_before integer NOT NULL,
    reserved_before integer NOT NULL,
    on_hand_after integer NOT NULL,
    reserved_after integer NOT NULL,
    source_key varchar(255),
    note text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT saas_china_inventory_movements_inventory_workspace_fkey
      FOREIGN KEY (inventory_id, user_id)
      REFERENCES saas_china_inventory(id, user_id)
      ON DELETE RESTRICT,
    CONSTRAINT saas_china_inventory_movements_type_check CHECK (
      movement_type IN (
        'opening_balance',
        'arrival',
        'manual_adjustment',
        'shipment_reservation',
        'shipment_release',
        'shipment_dispatch'
      )
    ),
    CONSTRAINT saas_china_inventory_movements_has_delta
      CHECK (on_hand_delta <> 0 OR reserved_delta <> 0),
    CONSTRAINT saas_china_inventory_movements_balances_nonnegative CHECK (
      on_hand_before >= 0
      AND reserved_before >= 0
      AND on_hand_after >= 0
      AND reserved_after >= 0
    ),
    CONSTRAINT saas_china_inventory_movements_on_hand_balance
      CHECK (on_hand_after = on_hand_before + on_hand_delta),
    CONSTRAINT saas_china_inventory_movements_reserved_balance
      CHECK (reserved_after = reserved_before + reserved_delta),
    CONSTRAINT saas_china_inventory_movements_reserved_within_on_hand CHECK (
      reserved_before <= on_hand_before
      AND reserved_after <= on_hand_after
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS saas_china_inventory_movements_user_source_key
    ON saas_china_inventory_movements(user_id, source_key);
  CREATE INDEX IF NOT EXISTS saas_china_inventory_movements_inventory_occurred
    ON saas_china_inventory_movements(inventory_id, occurred_at);
  CREATE INDEX IF NOT EXISTS saas_china_inventory_movements_user_occurred
    ON saas_china_inventory_movements(user_id, occurred_at);

  CREATE TABLE IF NOT EXISTS china_outbound_shipments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    shipment_no varchar(100) NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'draft',
    origin_warehouse_code varchar(100) NOT NULL DEFAULT 'default',
    destination_name text,
    destination_address text,
    forwarder_name varchar(200),
    external_reference varchar(200),
    planned_outbound_date date,
    dispatched_at timestamptz,
    cancelled_at timestamptz,
    memo text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT china_outbound_shipments_id_user_key UNIQUE (id, user_id),
    CONSTRAINT china_outbound_shipments_status_check CHECK (
      status IN ('draft', 'packing', 'ready', 'dispatched', 'cancelled')
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_shipments_user_shipment_no
    ON china_outbound_shipments(user_id, shipment_no);
  CREATE INDEX IF NOT EXISTS china_outbound_shipments_user_status_created
    ON china_outbound_shipments(user_id, status, created_at);
  CREATE INDEX IF NOT EXISTS china_outbound_shipments_user_planned_outbound
    ON china_outbound_shipments(user_id, planned_outbound_date);

  CREATE TABLE IF NOT EXISTS china_outbound_shipment_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sku varchar(100) NOT NULL,
    product_name text NOT NULL,
    option_key varchar(200) NOT NULL DEFAULT '',
    option_name varchar(200),
    reserved_quantity integer NOT NULL,
    packed_quantity integer NOT NULL DEFAULT 0,
    dispatched_quantity integer NOT NULL DEFAULT 0,
    sort_order integer NOT NULL DEFAULT 0,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT china_outbound_shipment_items_id_shipment_user_key
      UNIQUE (id, shipment_id, user_id),
    CONSTRAINT china_outbound_shipment_items_shipment_workspace_fkey
      FOREIGN KEY (shipment_id, user_id)
      REFERENCES china_outbound_shipments(id, user_id)
      ON DELETE CASCADE,
    CONSTRAINT china_outbound_shipment_items_inventory_workspace_fkey
      FOREIGN KEY (inventory_id, user_id)
      REFERENCES saas_china_inventory(id, user_id)
      ON DELETE RESTRICT,
    CONSTRAINT china_outbound_shipment_items_reserved_positive CHECK (reserved_quantity > 0),
    CONSTRAINT china_outbound_shipment_items_packed_within_reserved CHECK (
      packed_quantity >= 0 AND packed_quantity <= reserved_quantity
    ),
    CONSTRAINT china_outbound_shipment_items_dispatched_within_packed CHECK (
      dispatched_quantity >= 0 AND dispatched_quantity <= packed_quantity
    ),
    CONSTRAINT china_outbound_shipment_items_sort_nonnegative CHECK (sort_order >= 0)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_shipment_items_shipment_inventory
    ON china_outbound_shipment_items(shipment_id, inventory_id);
  CREATE INDEX IF NOT EXISTS china_outbound_shipment_items_inventory
    ON china_outbound_shipment_items(inventory_id);
  CREATE INDEX IF NOT EXISTS china_outbound_shipment_items_user_inventory
    ON china_outbound_shipment_items(user_id, inventory_id);
  CREATE INDEX IF NOT EXISTS china_outbound_shipment_items_shipment_sort
    ON china_outbound_shipment_items(shipment_id, sort_order);

  CREATE TABLE IF NOT EXISTS china_outbound_pallets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id uuid NOT NULL,
    user_id uuid NOT NULL,
    pallet_no varchar(100) NOT NULL,
    label_code varchar(200),
    sort_order integer NOT NULL DEFAULT 0,
    gross_weight_kg numeric(12, 3),
    length_cm numeric(12, 2),
    width_cm numeric(12, 2),
    height_cm numeric(12, 2),
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT china_outbound_pallets_id_shipment_user_key
      UNIQUE (id, shipment_id, user_id),
    CONSTRAINT china_outbound_pallets_shipment_workspace_fkey
      FOREIGN KEY (shipment_id, user_id)
      REFERENCES china_outbound_shipments(id, user_id)
      ON DELETE CASCADE,
    CONSTRAINT china_outbound_pallets_sort_nonnegative CHECK (sort_order >= 0),
    CONSTRAINT china_outbound_pallets_measurements_nonnegative CHECK (
      (gross_weight_kg IS NULL OR gross_weight_kg >= 0)
      AND (length_cm IS NULL OR length_cm >= 0)
      AND (width_cm IS NULL OR width_cm >= 0)
      AND (height_cm IS NULL OR height_cm >= 0)
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_pallets_shipment_pallet_no
    ON china_outbound_pallets(shipment_id, pallet_no);
  CREATE INDEX IF NOT EXISTS china_outbound_pallets_shipment_sort
    ON china_outbound_pallets(shipment_id, sort_order);
  CREATE INDEX IF NOT EXISTS china_outbound_pallets_user_shipment
    ON china_outbound_pallets(user_id, shipment_id);

  CREATE TABLE IF NOT EXISTS china_outbound_boxes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id uuid NOT NULL,
    pallet_id uuid,
    user_id uuid NOT NULL,
    box_no varchar(100) NOT NULL,
    label_code varchar(200),
    status varchar(30) NOT NULL DEFAULT 'open',
    sort_order integer NOT NULL DEFAULT 0,
    gross_weight_kg numeric(12, 3),
    length_cm numeric(12, 2),
    width_cm numeric(12, 2),
    height_cm numeric(12, 2),
    sealed_at timestamptz,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT china_outbound_boxes_id_shipment_user_key
      UNIQUE (id, shipment_id, user_id),
    CONSTRAINT china_outbound_boxes_shipment_workspace_fkey
      FOREIGN KEY (shipment_id, user_id)
      REFERENCES china_outbound_shipments(id, user_id)
      ON DELETE CASCADE,
    CONSTRAINT china_outbound_boxes_pallet_shipment_workspace_fkey
      FOREIGN KEY (pallet_id, shipment_id, user_id)
      REFERENCES china_outbound_pallets(id, shipment_id, user_id)
      ON DELETE RESTRICT,
    CONSTRAINT china_outbound_boxes_status_check CHECK (status IN ('open', 'sealed')),
    CONSTRAINT china_outbound_boxes_sort_nonnegative CHECK (sort_order >= 0),
    CONSTRAINT china_outbound_boxes_measurements_nonnegative CHECK (
      (gross_weight_kg IS NULL OR gross_weight_kg >= 0)
      AND (length_cm IS NULL OR length_cm >= 0)
      AND (width_cm IS NULL OR width_cm >= 0)
      AND (height_cm IS NULL OR height_cm >= 0)
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_boxes_shipment_box_no
    ON china_outbound_boxes(shipment_id, box_no);
  CREATE INDEX IF NOT EXISTS china_outbound_boxes_shipment_sort
    ON china_outbound_boxes(shipment_id, sort_order);
  CREATE INDEX IF NOT EXISTS china_outbound_boxes_user_shipment
    ON china_outbound_boxes(user_id, shipment_id);
  CREATE INDEX IF NOT EXISTS china_outbound_boxes_pallet
    ON china_outbound_boxes(pallet_id);

  CREATE TABLE IF NOT EXISTS china_outbound_box_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    box_id uuid NOT NULL,
    shipment_id uuid NOT NULL,
    shipment_item_id uuid NOT NULL,
    user_id uuid NOT NULL,
    quantity integer NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT china_outbound_box_items_box_shipment_workspace_fkey
      FOREIGN KEY (box_id, shipment_id, user_id)
      REFERENCES china_outbound_boxes(id, shipment_id, user_id)
      ON DELETE CASCADE,
    CONSTRAINT china_outbound_box_items_shipment_item_workspace_fkey
      FOREIGN KEY (shipment_item_id, shipment_id, user_id)
      REFERENCES china_outbound_shipment_items(id, shipment_id, user_id)
      ON DELETE CASCADE,
    CONSTRAINT china_outbound_box_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT china_outbound_box_items_sort_nonnegative CHECK (sort_order >= 0)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS china_outbound_box_items_box_shipment_item
    ON china_outbound_box_items(box_id, shipment_item_id);
  CREATE INDEX IF NOT EXISTS china_outbound_box_items_shipment_item
    ON china_outbound_box_items(shipment_item_id);
  CREATE INDEX IF NOT EXISTS china_outbound_box_items_shipment_user
    ON china_outbound_box_items(shipment_id, user_id);

  ALTER TABLE saas_china_inventory ENABLE ROW LEVEL SECURITY;
  ALTER TABLE saas_china_inventory_movements ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_shipments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_shipment_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_pallets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_boxes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_box_items ENABLE ROW LEVEL SECURITY;

  REVOKE ALL ON TABLE saas_china_inventory FROM anon, authenticated;
  REVOKE ALL ON TABLE saas_china_inventory_movements FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_shipments FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_shipment_items FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_pallets FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_boxes FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_box_items FROM anon, authenticated;
`

let ensureSaasChinaOutboundSchemaPromise: Promise<void> | null = null

export function ensureSaasChinaOutboundSchema() {
  ensureSaasChinaOutboundSchemaPromise ??= db
    .execute(SAAS_CHINA_OUTBOUND_SCHEMA_SQL)
    .then(() => undefined)
    .catch((error) => {
      ensureSaasChinaOutboundSchemaPromise = null
      throw error
    })

  return ensureSaasChinaOutboundSchemaPromise
}

export async function getSaasChinaInventory(userId: string) {
  await ensureSaasChinaOutboundSchema()
  const [items, [summary]] = await Promise.all([
    db
      .select()
      .from(saasChinaInventory)
      .where(eq(saasChinaInventory.userId, userId))
      .orderBy(
        asc(saasChinaInventory.warehouseCode),
        asc(saasChinaInventory.sku),
        asc(saasChinaInventory.optionKey),
      ),
    db
      .select({
        onHandQuantity: sql<number>`COALESCE(SUM(${saasChinaInventory.onHandQuantity}), 0)::int`,
        reservedQuantity: sql<number>`COALESCE(SUM(${saasChinaInventory.reservedQuantity}), 0)::int`,
        availableQuantity: sql<number>`COALESCE(SUM(${saasChinaInventory.availableQuantity}), 0)::int`,
      })
      .from(saasChinaInventory)
      .where(eq(saasChinaInventory.userId, userId)),
  ])

  return {
    items,
    summary: summary ?? { onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0 },
  }
}

export async function listChinaOutboundShipments(userId: string) {
  await ensureSaasChinaOutboundSchema()
  const [shipments, itemCounts] = await Promise.all([
    db
      .select()
      .from(chinaOutboundShipments)
      .where(eq(chinaOutboundShipments.userId, userId))
      .orderBy(desc(chinaOutboundShipments.createdAt)),
    db
      .select({
        shipmentId: chinaOutboundShipmentItems.shipmentId,
        itemCount: sql<number>`COUNT(*)::int`,
        reservedQuantity: sql<number>`COALESCE(SUM(${chinaOutboundShipmentItems.reservedQuantity}), 0)::int`,
        packedQuantity: sql<number>`COALESCE(SUM(${chinaOutboundShipmentItems.packedQuantity}), 0)::int`,
      })
      .from(chinaOutboundShipmentItems)
      .where(eq(chinaOutboundShipmentItems.userId, userId))
      .groupBy(chinaOutboundShipmentItems.shipmentId),
  ])

  const countsByShipmentId = new Map(itemCounts.map((item) => [item.shipmentId, item]))
  return shipments.map((shipment) => ({
    ...shipment,
    itemCount: countsByShipmentId.get(shipment.id)?.itemCount ?? 0,
    reservedQuantity: countsByShipmentId.get(shipment.id)?.reservedQuantity ?? 0,
    packedQuantity: countsByShipmentId.get(shipment.id)?.packedQuantity ?? 0,
  }))
}

export async function getChinaOutboundShipmentDetail(input: { userId: string; shipmentId: string }) {
  await ensureSaasChinaOutboundSchema()
  const [shipment] = await db
    .select()
    .from(chinaOutboundShipments)
    .where(and(
      eq(chinaOutboundShipments.userId, input.userId),
      eq(chinaOutboundShipments.id, input.shipmentId),
    ))
    .limit(1)

  if (!shipment) return null

  const [items, pallets, boxes] = await Promise.all([
    db
      .select()
      .from(chinaOutboundShipmentItems)
      .where(and(
        eq(chinaOutboundShipmentItems.userId, input.userId),
        eq(chinaOutboundShipmentItems.shipmentId, shipment.id),
      ))
      .orderBy(asc(chinaOutboundShipmentItems.sortOrder), asc(chinaOutboundShipmentItems.createdAt)),
    db
      .select()
      .from(chinaOutboundPallets)
      .where(and(
        eq(chinaOutboundPallets.userId, input.userId),
        eq(chinaOutboundPallets.shipmentId, shipment.id),
      ))
      .orderBy(asc(chinaOutboundPallets.sortOrder), asc(chinaOutboundPallets.createdAt)),
    db
      .select()
      .from(chinaOutboundBoxes)
      .where(and(
        eq(chinaOutboundBoxes.userId, input.userId),
        eq(chinaOutboundBoxes.shipmentId, shipment.id),
      ))
      .orderBy(asc(chinaOutboundBoxes.sortOrder), asc(chinaOutboundBoxes.createdAt)),
  ])

  const boxIds = boxes.map((box) => box.id)
  const itemIds = items.map((item) => item.id)
  const boxItems = boxIds.length === 0 || itemIds.length === 0
    ? []
    : await db
      .select()
      .from(chinaOutboundBoxItems)
      .where(and(
        eq(chinaOutboundBoxItems.userId, input.userId),
        eq(chinaOutboundBoxItems.shipmentId, shipment.id),
        inArray(chinaOutboundBoxItems.boxId, boxIds),
        inArray(chinaOutboundBoxItems.shipmentItemId, itemIds),
      ))
      .orderBy(asc(chinaOutboundBoxItems.sortOrder), asc(chinaOutboundBoxItems.createdAt))

  return {
    shipment,
    items,
    pallets,
    boxes,
    boxItems,
  }
}

export async function receiveSaasChinaInventory(input: SaasChinaInventoryInput) {
  await ensureSaasChinaOutboundSchema()
  const quantity = positiveInteger(input.quantity, '입고 수량')
  const sku = requiredText(input.sku, '품목코드')
  const productName = requiredText(input.productName, '상품명')
  const warehouseCode = requiredText(input.warehouseCode, '중국창고')
  const optionName = optionalText(input.optionName)
  const optionKey = optionName ?? ''

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const [existing] = await tx
      .select()
      .from(saasChinaInventory)
      .where(and(
        eq(saasChinaInventory.userId, input.userId),
        eq(saasChinaInventory.warehouseCode, warehouseCode),
        eq(saasChinaInventory.sku, sku),
        eq(saasChinaInventory.optionKey, optionKey),
      ))
      .limit(1)

    const beforeOnHand = existing?.onHandQuantity ?? 0
    const beforeReserved = existing?.reservedQuantity ?? 0
    const afterOnHand = beforeOnHand + quantity
    const afterReserved = beforeReserved
    const afterAvailable = afterOnHand - afterReserved

    const inventory = existing
      ? (await tx
        .update(saasChinaInventory)
        .set({
          productName,
          optionName,
          onHandQuantity: afterOnHand,
          availableQuantity: afterAvailable,
          lastReceivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(saasChinaInventory.id, existing.id))
        .returning())[0]
      : (await tx
        .insert(saasChinaInventory)
        .values({
          userId: input.userId,
          warehouseCode,
          sku,
          productName,
          optionKey,
          optionName,
          onHandQuantity: afterOnHand,
          reservedQuantity: afterReserved,
          availableQuantity: afterAvailable,
          lastReceivedAt: new Date(),
          createdBy: input.createdBy,
        })
        .returning())[0]

    if (!inventory) throw new Error('SaaS 중국재고를 저장하지 못했습니다.')
    await insertSaasChinaInventoryMovement(tx, {
      inventoryId: inventory.id,
      userId: input.userId,
      movementType: 'arrival',
      onHandDelta: quantity,
      reservedDelta: 0,
      onHandBefore: beforeOnHand,
      reservedBefore: beforeReserved,
      onHandAfter: afterOnHand,
      reservedAfter: afterReserved,
      sourceKey: `saas-china-arrival:${randomUUID()}`,
      note: optionalText(input.note),
      createdBy: input.createdBy,
    })

    return inventory
  })
}

export async function adjustSaasChinaInventory(input: SaasChinaInventoryAdjustmentInput) {
  await ensureSaasChinaOutboundSchema()
  const delta = nonZeroInteger(input.delta, '조정 수량')
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const inventory = await getSaasChinaInventoryForUpdate(tx, input.userId, input.inventoryId)
    const afterOnHand = inventory.onHandQuantity + delta
    if (afterOnHand < inventory.reservedQuantity) {
      throw new Error(`예약된 ${inventory.reservedQuantity.toLocaleString('ko-KR')}개보다 적게 재고를 줄일 수 없습니다.`)
    }

    const afterAvailable = afterOnHand - inventory.reservedQuantity
    const [updated] = await tx
      .update(saasChinaInventory)
      .set({
        onHandQuantity: afterOnHand,
        availableQuantity: afterAvailable,
        updatedAt: new Date(),
      })
      .where(eq(saasChinaInventory.id, inventory.id))
      .returning()
    if (!updated) throw new Error('SaaS 중국재고 조정에 실패했습니다.')

    await insertSaasChinaInventoryMovement(tx, {
      inventoryId: inventory.id,
      userId: input.userId,
      movementType: 'manual_adjustment',
      onHandDelta: delta,
      reservedDelta: 0,
      onHandBefore: inventory.onHandQuantity,
      reservedBefore: inventory.reservedQuantity,
      onHandAfter: afterOnHand,
      reservedAfter: inventory.reservedQuantity,
      sourceKey: `saas-china-adjustment:${randomUUID()}`,
      note: optionalText(input.note),
      createdBy: input.createdBy,
    })

    return updated
  })
}

export async function createChinaOutboundShipment(input: CreateChinaOutboundShipmentInput) {
  await ensureSaasChinaOutboundSchema()
  const normalizedLines = normalizeShipmentLines(input.lines)
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const inventoryIds = normalizedLines.map((line) => line.inventoryId)
    const inventories = await tx
      .select()
      .from(saasChinaInventory)
      .where(and(
        eq(saasChinaInventory.userId, input.userId),
        inArray(saasChinaInventory.id, inventoryIds),
      ))
    if (inventories.length !== inventoryIds.length) {
      throw new Error('SaaS 중국재고에서 찾을 수 없는 출고 품목이 있습니다.')
    }

    const inventoriesById = new Map(inventories.map((inventory) => [inventory.id, inventory]))
    const warehouseCodes = new Set(inventories.map((inventory) => inventory.warehouseCode))
    if (warehouseCodes.size !== 1) {
      throw new Error('한 출고작업에는 같은 중국창고의 재고만 선택해주세요.')
    }

    for (const line of normalizedLines) {
      const inventory = inventoriesById.get(line.inventoryId)
      if (!inventory) throw new Error('SaaS 중국재고를 찾을 수 없습니다.')
      if (line.quantity > inventory.availableQuantity) {
        throw new Error(`${inventory.sku}의 작업 가능 수량은 ${inventory.availableQuantity.toLocaleString('ko-KR')}개입니다.`)
      }
    }

    const shipmentNo = optionalText(input.shipmentNo) ?? createShipmentNo()
    const [shipment] = await tx
      .insert(chinaOutboundShipments)
      .values({
        userId: input.userId,
        shipmentNo,
        status: 'draft',
        originWarehouseCode: inventories[0]!.warehouseCode,
        destinationName: optionalText(input.destinationName),
        destinationAddress: optionalText(input.destinationAddress),
        forwarderName: optionalText(input.forwarderName),
        externalReference: optionalText(input.externalReference),
        plannedOutboundDate: optionalText(input.plannedOutboundDate),
        memo: optionalText(input.memo),
        createdBy: input.createdBy,
      })
      .returning()
    if (!shipment) throw new Error('중국출고 작업을 만들지 못했습니다.')

    for (const [index, line] of normalizedLines.entries()) {
      const inventory = inventoriesById.get(line.inventoryId)!
      await tx.insert(chinaOutboundShipmentItems).values({
        shipmentId: shipment.id,
        inventoryId: inventory.id,
        userId: input.userId,
        sku: inventory.sku,
        productName: inventory.productName,
        optionKey: inventory.optionKey,
        optionName: inventory.optionName,
        reservedQuantity: line.quantity,
        sortOrder: index,
      })

      const afterReserved = inventory.reservedQuantity + line.quantity
      const afterAvailable = inventory.onHandQuantity - afterReserved
      await tx
        .update(saasChinaInventory)
        .set({
          reservedQuantity: afterReserved,
          availableQuantity: afterAvailable,
          updatedAt: new Date(),
        })
        .where(eq(saasChinaInventory.id, inventory.id))
      await insertSaasChinaInventoryMovement(tx, {
        inventoryId: inventory.id,
        userId: input.userId,
        movementType: 'shipment_reservation',
        onHandDelta: 0,
        reservedDelta: line.quantity,
        onHandBefore: inventory.onHandQuantity,
        reservedBefore: inventory.reservedQuantity,
        onHandAfter: inventory.onHandQuantity,
        reservedAfter: afterReserved,
        sourceKey: `china-outbound-reservation:${shipment.id}:${inventory.id}`,
        note: shipment.shipmentNo,
        createdBy: input.createdBy,
      })
    }

    return shipment
  })
}

export async function addChinaOutboundPallet(input: {
  userId: string
  shipmentId: string
  palletNo: string
  note?: string | null
}) {
  await ensureSaasChinaOutboundSchema()
  const palletNo = requiredText(input.palletNo, '파렛트 번호')
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const [{ count: currentCount }] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(chinaOutboundPallets)
      .where(and(eq(chinaOutboundPallets.userId, input.userId), eq(chinaOutboundPallets.shipmentId, input.shipmentId)))
    const [pallet] = await tx
      .insert(chinaOutboundPallets)
      .values({
        shipmentId: input.shipmentId,
        userId: input.userId,
        palletNo,
        note: optionalText(input.note),
        sortOrder: currentCount ?? 0,
      })
      .returning()
    if (!pallet) throw new Error('파렛트를 추가하지 못했습니다.')
    return pallet
  })
}

export async function addChinaOutboundBox(input: {
  userId: string
  shipmentId: string
  palletId: string
  boxNo: string
  note?: string | null
}) {
  await ensureSaasChinaOutboundSchema()
  const boxNo = requiredText(input.boxNo, '박스 번호')
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    await getChinaOutboundPallet(tx, input.userId, input.shipmentId, input.palletId)
    const [{ count: currentCount }] = await tx
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(chinaOutboundBoxes)
      .where(and(eq(chinaOutboundBoxes.userId, input.userId), eq(chinaOutboundBoxes.shipmentId, input.shipmentId)))
    const [box] = await tx
      .insert(chinaOutboundBoxes)
      .values({
        shipmentId: input.shipmentId,
        palletId: input.palletId,
        userId: input.userId,
        boxNo,
        note: optionalText(input.note),
        sortOrder: currentCount ?? 0,
      })
      .returning()
    if (!box) throw new Error('박스를 추가하지 못했습니다.')
    return box
  })
}

export async function addChinaOutboundBoxItem(input: {
  userId: string
  shipmentId: string
  boxId: string
  shipmentItemId: string
  quantity: number
}) {
  await ensureSaasChinaOutboundSchema()
  const quantity = positiveInteger(input.quantity, '박스 적재 수량')
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const [box, shipmentItem] = await Promise.all([
      getChinaOutboundBox(tx, input.userId, shipment.id, input.boxId),
      getChinaOutboundShipmentItem(tx, input.userId, shipment.id, input.shipmentItemId),
    ])
    if (box.status !== 'open') throw new Error('봉인된 박스에는 상품을 더 담을 수 없습니다.')
    const remainingQuantity = shipmentItem.reservedQuantity - shipmentItem.packedQuantity
    if (quantity > remainingQuantity) {
      throw new Error(`${shipmentItem.sku}의 미포장 수량은 ${remainingQuantity.toLocaleString('ko-KR')}개입니다.`)
    }

    const [existing] = await tx
      .select()
      .from(chinaOutboundBoxItems)
      .where(and(
        eq(chinaOutboundBoxItems.userId, input.userId),
        eq(chinaOutboundBoxItems.shipmentId, shipment.id),
        eq(chinaOutboundBoxItems.boxId, box.id),
        eq(chinaOutboundBoxItems.shipmentItemId, shipmentItem.id),
      ))
      .limit(1)

    if (existing) {
      await tx
        .update(chinaOutboundBoxItems)
        .set({ quantity: existing.quantity + quantity, updatedAt: new Date() })
        .where(eq(chinaOutboundBoxItems.id, existing.id))
    } else {
      await tx.insert(chinaOutboundBoxItems).values({
        boxId: box.id,
        shipmentId: shipment.id,
        shipmentItemId: shipmentItem.id,
        userId: input.userId,
        quantity,
      })
    }

    await tx
      .update(chinaOutboundShipmentItems)
      .set({ packedQuantity: shipmentItem.packedQuantity + quantity, updatedAt: new Date() })
      .where(eq(chinaOutboundShipmentItems.id, shipmentItem.id))
    if (shipment.status === 'draft') {
      await tx
        .update(chinaOutboundShipments)
        .set({ status: 'packing', updatedAt: new Date() })
        .where(eq(chinaOutboundShipments.id, shipment.id))
    }
  })
}

export async function removeChinaOutboundBoxItem(input: {
  userId: string
  shipmentId: string
  boxItemId: string
}) {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const [boxItem] = await tx
      .select({
        id: chinaOutboundBoxItems.id,
        quantity: chinaOutboundBoxItems.quantity,
        shipmentItemId: chinaOutboundBoxItems.shipmentItemId,
        boxId: chinaOutboundBoxItems.boxId,
      })
      .from(chinaOutboundBoxItems)
      .where(and(
        eq(chinaOutboundBoxItems.userId, input.userId),
        eq(chinaOutboundBoxItems.shipmentId, shipment.id),
        eq(chinaOutboundBoxItems.id, input.boxItemId),
      ))
      .limit(1)
    if (!boxItem) throw new Error('박스 적재 항목을 찾을 수 없습니다.')
    await getChinaOutboundBox(tx, input.userId, shipment.id, boxItem.boxId)
    const shipmentItem = await getChinaOutboundShipmentItem(tx, input.userId, shipment.id, boxItem.shipmentItemId)

    await tx.delete(chinaOutboundBoxItems).where(eq(chinaOutboundBoxItems.id, boxItem.id))
    await tx
      .update(chinaOutboundShipmentItems)
      .set({ packedQuantity: shipmentItem.packedQuantity - boxItem.quantity, updatedAt: new Date() })
      .where(eq(chinaOutboundShipmentItems.id, shipmentItem.id))
  })
}

export async function markChinaOutboundShipmentReady(input: { userId: string; shipmentId: string }) {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    await assertShipmentFullyPacked(tx, input.userId, shipment.id)
    const [updated] = await tx
      .update(chinaOutboundShipments)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(chinaOutboundShipments.id, shipment.id))
      .returning()
    if (!updated) throw new Error('포장완료 상태로 바꾸지 못했습니다.')
    return updated
  })
}

export async function dispatchChinaOutboundShipment(input: { userId: string; createdBy: string; shipmentId: string }) {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getChinaOutboundShipment(tx, input.userId, input.shipmentId)
    if (shipment.status !== 'ready') {
      throw new Error('포장완료 상태의 출고작업만 출고완료 처리할 수 있습니다.')
    }
    const items = await tx
      .select()
      .from(chinaOutboundShipmentItems)
      .where(and(
        eq(chinaOutboundShipmentItems.userId, input.userId),
        eq(chinaOutboundShipmentItems.shipmentId, shipment.id),
      ))
    await assertShipmentFullyPacked(tx, input.userId, shipment.id, items)

    for (const item of items) {
      const inventory = await getSaasChinaInventoryForUpdate(tx, input.userId, item.inventoryId)
      if (inventory.reservedQuantity < item.reservedQuantity || inventory.onHandQuantity < item.reservedQuantity) {
        throw new Error(`${item.sku}의 SaaS 중국재고가 출고 예약과 맞지 않습니다. 재고를 확인해주세요.`)
      }
      const afterOnHand = inventory.onHandQuantity - item.reservedQuantity
      const afterReserved = inventory.reservedQuantity - item.reservedQuantity
      const afterAvailable = afterOnHand - afterReserved
      await tx
        .update(saasChinaInventory)
        .set({
          onHandQuantity: afterOnHand,
          reservedQuantity: afterReserved,
          availableQuantity: afterAvailable,
          lastOutboundAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(saasChinaInventory.id, inventory.id))
      await insertSaasChinaInventoryMovement(tx, {
        inventoryId: inventory.id,
        userId: input.userId,
        movementType: 'shipment_dispatch',
        onHandDelta: -item.reservedQuantity,
        reservedDelta: -item.reservedQuantity,
        onHandBefore: inventory.onHandQuantity,
        reservedBefore: inventory.reservedQuantity,
        onHandAfter: afterOnHand,
        reservedAfter: afterReserved,
        sourceKey: `china-outbound-dispatch:${shipment.id}:${inventory.id}`,
        note: shipment.shipmentNo,
        createdBy: input.createdBy,
      })
      await tx
        .update(chinaOutboundShipmentItems)
        .set({ dispatchedQuantity: item.reservedQuantity, updatedAt: new Date() })
        .where(eq(chinaOutboundShipmentItems.id, item.id))
    }

    const [updated] = await tx
      .update(chinaOutboundShipments)
      .set({ status: 'dispatched', dispatchedAt: new Date(), updatedAt: new Date() })
      .where(eq(chinaOutboundShipments.id, shipment.id))
      .returning()
    if (!updated) throw new Error('출고완료 처리에 실패했습니다.')
    return updated
  })
}

export async function cancelChinaOutboundShipment(input: { userId: string; createdBy: string; shipmentId: string }) {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getChinaOutboundShipment(tx, input.userId, input.shipmentId)
    if (!EDITABLE_SHIPMENT_STATUSES.includes(shipment.status as ChinaOutboundShipmentStatus) && shipment.status !== 'ready') {
      throw new Error('출고완료 또는 취소된 작업은 취소할 수 없습니다.')
    }
    const items = await tx
      .select()
      .from(chinaOutboundShipmentItems)
      .where(and(
        eq(chinaOutboundShipmentItems.userId, input.userId),
        eq(chinaOutboundShipmentItems.shipmentId, shipment.id),
      ))
    for (const item of items) {
      const inventory = await getSaasChinaInventoryForUpdate(tx, input.userId, item.inventoryId)
      if (inventory.reservedQuantity < item.reservedQuantity) {
        throw new Error(`${item.sku}의 예약 수량이 맞지 않아 출고작업을 취소할 수 없습니다.`)
      }
      const afterReserved = inventory.reservedQuantity - item.reservedQuantity
      const afterAvailable = inventory.onHandQuantity - afterReserved
      await tx
        .update(saasChinaInventory)
        .set({ reservedQuantity: afterReserved, availableQuantity: afterAvailable, updatedAt: new Date() })
        .where(eq(saasChinaInventory.id, inventory.id))
      await insertSaasChinaInventoryMovement(tx, {
        inventoryId: inventory.id,
        userId: input.userId,
        movementType: 'shipment_release',
        onHandDelta: 0,
        reservedDelta: -item.reservedQuantity,
        onHandBefore: inventory.onHandQuantity,
        reservedBefore: inventory.reservedQuantity,
        onHandAfter: inventory.onHandQuantity,
        reservedAfter: afterReserved,
        sourceKey: `china-outbound-release:${shipment.id}:${inventory.id}`,
        note: shipment.shipmentNo,
        createdBy: input.createdBy,
      })
    }
    const [updated] = await tx
      .update(chinaOutboundShipments)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(chinaOutboundShipments.id, shipment.id))
      .returning()
    if (!updated) throw new Error('출고작업 취소에 실패했습니다.')
    return updated
  })
}

async function assertShipmentFullyPacked(
  tx: DbTransaction,
  userId: string,
  shipmentId: string,
  preloadedItems?: ChinaOutboundShipmentItemRow[],
) {
  const items = preloadedItems ?? await tx
    .select()
    .from(chinaOutboundShipmentItems)
    .where(and(
      eq(chinaOutboundShipmentItems.userId, userId),
      eq(chinaOutboundShipmentItems.shipmentId, shipmentId),
    ))
  if (items.length === 0) throw new Error('출고 상품이 없는 작업은 포장완료 처리할 수 없습니다.')
  const unfinished = items.find((item) => item.packedQuantity !== item.reservedQuantity)
  if (unfinished) {
    throw new Error(`${unfinished.sku}의 포장수량(${unfinished.packedQuantity.toLocaleString('ko-KR')})이 출고수량(${unfinished.reservedQuantity.toLocaleString('ko-KR')})과 다릅니다.`)
  }
  const boxes = await tx
    .select({ id: chinaOutboundBoxes.id, palletId: chinaOutboundBoxes.palletId })
    .from(chinaOutboundBoxes)
    .where(and(eq(chinaOutboundBoxes.userId, userId), eq(chinaOutboundBoxes.shipmentId, shipmentId)))
  if (boxes.length === 0) throw new Error('박스를 하나 이상 등록해주세요.')
  if (boxes.some((box) => !box.palletId)) throw new Error('모든 박스를 파렛트에 배치해주세요.')
}

async function getSaasChinaInventoryForUpdate(tx: DbTransaction, userId: string, inventoryId: string) {
  const [inventory] = await tx
    .select()
    .from(saasChinaInventory)
    .where(and(eq(saasChinaInventory.userId, userId), eq(saasChinaInventory.id, inventoryId)))
    .limit(1)
  if (!inventory) throw new Error('SaaS 중국재고를 찾을 수 없습니다.')
  return inventory
}

async function getChinaOutboundShipment(tx: DbTransaction, userId: string, shipmentId: string) {
  const [shipment] = await tx
    .select()
    .from(chinaOutboundShipments)
    .where(and(eq(chinaOutboundShipments.userId, userId), eq(chinaOutboundShipments.id, shipmentId)))
    .limit(1)
  if (!shipment) throw new Error('중국출고 작업을 찾을 수 없습니다.')
  return shipment
}

async function getEditableChinaOutboundShipment(tx: DbTransaction, userId: string, shipmentId: string) {
  const shipment = await getChinaOutboundShipment(tx, userId, shipmentId)
  if (!EDITABLE_SHIPMENT_STATUSES.includes(shipment.status as ChinaOutboundShipmentStatus)) {
    throw new Error('초안 또는 포장중 상태에서만 내용을 수정할 수 있습니다.')
  }
  return shipment
}

async function getChinaOutboundPallet(tx: DbTransaction, userId: string, shipmentId: string, palletId: string) {
  const [pallet] = await tx
    .select()
    .from(chinaOutboundPallets)
    .where(and(
      eq(chinaOutboundPallets.userId, userId),
      eq(chinaOutboundPallets.shipmentId, shipmentId),
      eq(chinaOutboundPallets.id, palletId),
    ))
    .limit(1)
  if (!pallet) throw new Error('해당 출고작업의 파렛트를 찾을 수 없습니다.')
  return pallet
}

async function getChinaOutboundBox(tx: DbTransaction, userId: string, shipmentId: string, boxId: string) {
  const [box] = await tx
    .select()
    .from(chinaOutboundBoxes)
    .where(and(
      eq(chinaOutboundBoxes.userId, userId),
      eq(chinaOutboundBoxes.shipmentId, shipmentId),
      eq(chinaOutboundBoxes.id, boxId),
    ))
    .limit(1)
  if (!box) throw new Error('해당 출고작업의 박스를 찾을 수 없습니다.')
  return box
}

async function getChinaOutboundShipmentItem(tx: DbTransaction, userId: string, shipmentId: string, shipmentItemId: string) {
  const [item] = await tx
    .select()
    .from(chinaOutboundShipmentItems)
    .where(and(
      eq(chinaOutboundShipmentItems.userId, userId),
      eq(chinaOutboundShipmentItems.shipmentId, shipmentId),
      eq(chinaOutboundShipmentItems.id, shipmentItemId),
    ))
    .limit(1)
  if (!item) throw new Error('해당 출고작업의 상품을 찾을 수 없습니다.')
  return item
}

async function insertSaasChinaInventoryMovement(
  tx: DbTransaction,
  input: typeof saasChinaInventoryMovements.$inferInsert,
) {
  await tx.insert(saasChinaInventoryMovements).values(input)
}

async function lockSaasChinaOutboundWorkspace(tx: DbTransaction, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`saas-china-outbound:${userId}`}))`)
}

function normalizeShipmentLines(lines: ChinaOutboundShipmentLineInput[]) {
  const quantitiesByInventoryId = new Map<string, number>()
  for (const line of lines) {
    const inventoryId = requiredText(line.inventoryId, '재고 항목')
    const quantity = positiveInteger(line.quantity, '출고 수량')
    quantitiesByInventoryId.set(inventoryId, (quantitiesByInventoryId.get(inventoryId) ?? 0) + quantity)
  }
  if (quantitiesByInventoryId.size === 0) throw new Error('출고할 SaaS 중국재고를 하나 이상 선택해주세요.')
  return [...quantitiesByInventoryId.entries()].map(([inventoryId, quantity]) => ({ inventoryId, quantity }))
}

function requiredText(value: string | null | undefined, label: string) {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${label}을(를) 입력해주세요.`)
  return normalized
}

function optionalText(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || null
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}은(는) 1 이상의 정수여야 합니다.`)
  return value
}

function nonZeroInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value === 0) throw new Error(`${label}은(는) 0이 아닌 정수여야 합니다.`)
  return value
}

function createShipmentNo() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value
  const date = `${part('year')}${part('month')}${part('day')}`
  return `CN-${date}-${randomUUID().slice(0, 6).toUpperCase()}`
}
