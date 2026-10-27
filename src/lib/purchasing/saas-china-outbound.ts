import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  isSaasChinaInventoryExcludedWarehouseCode,
  SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_ERROR,
  type SaasChinaInventoryExcelRow,
} from './saas-china-inventory-excel'
import {
  createChinaOutboundRegistrationWorkbookFingerprint,
  type ChinaOutboundRegistrationWorkbook,
  type ChinaOutboundRegistrationWorkbookError,
} from './china-outbound-registration-workbook'
import {
  chinaOutboundBoxItems,
  chinaOutboundBoxes,
  chinaOutboundPallets,
  chinaOutboundShipmentItems,
  chinaOutboundShipments,
  purchaseRequestItems,
  saasChinaInventory,
  saasChinaInventoryMovements,
  saasChinaOutboundWarehouses,
  saasChinaPurchaseLinks,
  saasChinaShipmentPurchaseAllocations,
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

export const CHINA_OUTBOUND_BOX_SPLIT_STATUSES = ['in_progress', 'completed'] as const

export type ChinaOutboundBoxSplitStatus = (typeof CHINA_OUTBOUND_BOX_SPLIT_STATUSES)[number]
export type ChinaOutboundCompletionStatus = ChinaOutboundBoxSplitStatus

export const CHINA_OUTBOUND_BOX_SPLIT_STATUS_LABELS: Record<ChinaOutboundBoxSplitStatus, string> = {
  in_progress: '진행 중',
  completed: '완료',
}

export const CHINA_OUTBOUND_ACTIVE_SHIPMENT_STATUSES = ['draft', 'packing', 'ready'] as const satisfies readonly ChinaOutboundShipmentStatus[]

export const CHINA_OUTBOUND_SHIPMENT_STATUS_LABELS: Record<ChinaOutboundShipmentStatus, string> = {
  draft: '초안',
  packing: '포장중',
  ready: '포장완료',
  dispatched: '출고완료',
  cancelled: '취소',
}

export function isChinaOutboundShipmentActive(status: ChinaOutboundShipmentStatus | string) {
  return status === 'draft' || status === 'packing' || status === 'ready'
}

/**
 * A dispatched shipment has already reduced SaaS China inventory. It must
 * remain as an audit record rather than being deleted from the workflow.
 */
export function isChinaOutboundShipmentDeletable(status: ChinaOutboundShipmentStatus) {
  return status === 'draft' || status === 'packing' || status === 'ready' || status === 'cancelled'
}

// Automatic purchase arrivals resolve the workspace's configured default
// warehouse so a user-managed rename is honored. This is never the replaceable
// Ecount/raw China-inventory table.
export const SAAS_CHINA_DEFAULT_WAREHOUSE_CODE = '중국창고'
export const SAAS_CHINA_MULTI_WAREHOUSE_CODE = '복수 창고'

export function getChinaOutboundOriginWarehouseCode(warehouseCodes: Iterable<string>) {
  const uniqueWarehouseCodes = new Set<string>()
  for (const warehouseCode of warehouseCodes) {
    const normalized = warehouseCode.trim()
    if (normalized) uniqueWarehouseCodes.add(normalized)
  }
  return uniqueWarehouseCodes.size === 1
    ? [...uniqueWarehouseCodes][0]!
    : SAAS_CHINA_MULTI_WAREHOUSE_CODE
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

export type SaasChinaOutboundWarehouse = {
  warehouseCode: string
  isDefault: boolean
  hasActiveInventory: boolean
}

export type SaasChinaInventoryWorkbookPreviewRow = {
  /** Workbook row, or null when a currently listed row is omitted by a full snapshot. */
  row: number | null
  inventoryId?: string | null
  warehouseCode: string
  sku: string
  productName: string | null
  optionName: string | null
  itemCategory?: string | null
  beforeQuantity: number | null
  afterQuantity: number | null
  status: 'new' | 'changed' | 'unchanged' | 'removed' | 'invalid' | 'protected'
  message?: string
}

export type SaasChinaInventoryWorkbookPreview = {
  summary: {
    newCount: number
    changedCount: number
    unchangedCount: number
    removedCount: number
    invalidCount: number
    rowCount: number
  }
  rows: SaasChinaInventoryWorkbookPreviewRow[]
  errors?: string[]
}

export type SaasChinaInventoryWorkbookApplyResult = {
  createdCount: number
  updatedCount: number
  archivedCount: number
  unchangedCount: number
}

export type SaasChinaPurchaseArrivalInput = {
  userId: string
  createdBy: string
  purchaseRequestItemId: string
  sku: string
  productName: string
  optionName?: string | null
  quantity: number
  warehouseCode?: string | null
}

export type SaasChinaPurchaseLifecycleStatus =
  | 'china_arrived'
  | 'outbound_requested'
  | 'completed'

export type SaasChinaPurchaseLotBalance = {
  id: string
  receivedQuantity: number
  reservedQuantity: number
  dispatchedQuantity: number
}

export type SaasChinaPurchaseLotAllocation = {
  purchaseLinkId: string
  reservedQuantity: number
}

/**
 * Keeps the purchase row's workflow status derived solely from its linked
 * SaaS China inventory lot. A reservation is an outbound request; only a
 * fully dispatched lot can complete the purchase row.
 */
export function getSaasChinaPurchaseLifecycleStatus(input: Omit<SaasChinaPurchaseLotBalance, 'id'>): SaasChinaPurchaseLifecycleStatus {
  const outboundQuantity = input.reservedQuantity + input.dispatchedQuantity
  if (input.receivedQuantity > 0 && input.dispatchedQuantity >= input.receivedQuantity) {
    return 'completed'
  }
  return outboundQuantity > 0 ? 'outbound_requested' : 'china_arrived'
}

/**
 * Allocates a shipment line to purchase lots in the caller's FIFO order.
 * `remainingQuantity` deliberately stays unlinked so manually entered or
 * opening-balance SaaS inventory can still be shipped alongside linked lots.
 */
export function allocateSaasChinaPurchaseLots(
  lots: ReadonlyArray<SaasChinaPurchaseLotBalance>,
  quantity: number,
) {
  let remainingQuantity = quantity
  const allocations: SaasChinaPurchaseLotAllocation[] = []

  for (const lot of lots) {
    if (remainingQuantity <= 0) break
    const allocatable = lot.receivedQuantity - lot.reservedQuantity - lot.dispatchedQuantity
    if (allocatable <= 0) continue
    const reservedQuantity = Math.min(remainingQuantity, allocatable)
    allocations.push({ purchaseLinkId: lot.id, reservedQuantity })
    remainingQuantity -= reservedQuantity
  }

  return { allocations, remainingQuantity }
}

export type ChinaOutboundShipmentLineInput = {
  inventoryId: string
  quantity: number
}

export type ConfigureChinaOutboundPackagingInput = {
  userId: string
  shipmentId: string
  palletCount: number
  boxCount: number
}

export type ChinaOutboundPackingAllocationInput = {
  palletNumber: number
  boxNumber: number
  quantity: number
}

/**
 * The current China-outbound flow deliberately keeps box splitting separate
 * from pallet loading. A box can be created and filled before the operator
 * knows which pallet it will be loaded on.
 */
export type ChinaOutboundBoxSplitInput = {
  boxNo: string
  quantity: number
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
}

export type ChinaOutboundPalletAssignmentInput = {
  boxNo: string
  palletNo: string | null
}

export type ChinaOutboundWorkbookBoxSplitInput = {
  shipmentItemId: string
  allocations: ChinaOutboundBoxSplitInput[]
}

export type ChinaOutboundBoxDimensionsInput = {
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
}

export type CreateChinaOutboundShipmentInput = {
  userId: string
  createdBy: string
  displayName?: string | null
  shipmentNo?: string | null
  destinationName?: string | null
  destinationAddress?: string | null
  forwarderName?: string | null
  externalReference?: string | null
  plannedOutboundDate?: string | null
  memo?: string | null
  lines: ChinaOutboundShipmentLineInput[]
}

export type ChinaOutboundRegistrationWorkbookPreview = {
  summary: {
    itemCount: number
    boxCount: number
    palletCount: number
    totalQuantity: number
    invalidCount: number
  }
  errors: ChinaOutboundRegistrationWorkbookError[]
  existingShipmentId: string | null
  existingShipmentNo: string | null
  alreadyRegistered: boolean
}

export type ChinaOutboundRegistrationWorkbookApplyResult = {
  shipmentId: string
  shipmentNo: string
  created: boolean
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ChinaOutboundShipmentRow = typeof chinaOutboundShipments.$inferSelect
type ChinaOutboundShipmentItemRow = typeof chinaOutboundShipmentItems.$inferSelect
type ChinaOutboundPalletRow = typeof chinaOutboundPallets.$inferSelect
type ChinaOutboundBoxRow = typeof chinaOutboundBoxes.$inferSelect
type ChinaOutboundBoxItemRow = typeof chinaOutboundBoxItems.$inferSelect
type SaasChinaPurchaseLinkRow = typeof saasChinaPurchaseLinks.$inferSelect

type ChinaOutboundShipmentCreationOptions = {
  /**
   * Workbook uploads have a stable import key. A retry must return the first
   * created shipment instead of reserving the same stock again.
   */
  idempotentShipmentNo?: boolean
  idempotencyFingerprint?: string
  /** Runs inside the reservation transaction after its shipment lines exist. */
  afterCreateInTransaction?: (input: {
    tx: DbTransaction
    shipment: ChinaOutboundShipmentRow
    shipmentItems: ChinaOutboundShipmentItemRow[]
  }) => Promise<void>
}

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
    item_category varchar(100),
    option_key varchar(200) NOT NULL DEFAULT '',
    option_name varchar(200),
    on_hand_quantity integer NOT NULL DEFAULT 0,
    reserved_quantity integer NOT NULL DEFAULT 0,
    available_quantity integer NOT NULL DEFAULT 0,
    last_received_at timestamptz,
    last_outbound_at timestamptz,
    archived_at timestamptz,
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

  ALTER TABLE saas_china_inventory
    ADD COLUMN IF NOT EXISTS archived_at timestamptz;
  ALTER TABLE saas_china_inventory
    ADD COLUMN IF NOT EXISTS item_category varchar(100);
  -- A replacement workbook creates a fresh active inventory generation.
  -- Retired rows stay for immutable movement/outbound/purchase references.
  DROP INDEX IF EXISTS saas_china_inventory_user_warehouse_sku_option;
  CREATE UNIQUE INDEX IF NOT EXISTS saas_china_inventory_user_warehouse_sku_option_active
    ON saas_china_inventory(user_id, warehouse_code, sku, option_key)
    WHERE archived_at IS NULL;
  CREATE INDEX IF NOT EXISTS saas_china_inventory_user_sku
    ON saas_china_inventory(user_id, sku);
  CREATE INDEX IF NOT EXISTS saas_china_inventory_user_warehouse_available
    ON saas_china_inventory(user_id, warehouse_code, sku)
    WHERE available_quantity > 0;
  CREATE INDEX IF NOT EXISTS saas_china_inventory_user_active
    ON saas_china_inventory(user_id)
    WHERE archived_at IS NULL;

  -- This list is intentionally separate from inventory rows so an operator
  -- can prepare a warehouse name before the first stock is received there.
  CREATE TABLE IF NOT EXISTS saas_china_outbound_warehouses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    warehouse_code varchar(100) NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT saas_china_outbound_warehouses_user_code_key
      UNIQUE (user_id, warehouse_code)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS saas_china_outbound_warehouses_user_default
    ON saas_china_outbound_warehouses(user_id)
    WHERE is_default;
  CREATE INDEX IF NOT EXISTS saas_china_outbound_warehouses_user_updated
    ON saas_china_outbound_warehouses(user_id, updated_at);

  -- This composite candidate key lets a bridge lot prove that its purchase
  -- row belongs to the same workspace as the isolated SaaS inventory record.
  CREATE UNIQUE INDEX IF NOT EXISTS purchase_request_items_id_user
    ON purchase_request_items(id, user_id);

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
    display_name varchar(200),
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

  -- CREATE TABLE IF NOT EXISTS does not evolve the existing production table.
  -- Keep this idempotent bootstrap in addition to the formal migration so
  -- older deployments receive the optional user-facing name on first use.
  ALTER TABLE china_outbound_shipments
    ADD COLUMN IF NOT EXISTS display_name varchar(200);

  CREATE TABLE IF NOT EXISTS china_outbound_shipment_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sku varchar(100) NOT NULL,
    product_name text NOT NULL,
    option_key varchar(200) NOT NULL DEFAULT '',
    option_name varchar(200),
    origin_warehouse_code varchar(100) NOT NULL DEFAULT 'default',
    reserved_quantity integer NOT NULL,
    packed_quantity integer NOT NULL DEFAULT 0,
    dispatched_quantity integer NOT NULL DEFAULT 0,
    box_split_status varchar(20),
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
    CONSTRAINT china_outbound_shipment_items_box_split_status CHECK (
      box_split_status IS NULL OR box_split_status IN ('in_progress', 'completed')
    ),
    CONSTRAINT china_outbound_shipment_items_sort_nonnegative CHECK (sort_order >= 0)
  );

  ALTER TABLE china_outbound_shipment_items
    ADD COLUMN IF NOT EXISTS box_split_status varchar(20);
  ALTER TABLE china_outbound_shipment_items
    ADD COLUMN IF NOT EXISTS origin_warehouse_code varchar(100);

  -- A warehouse can be renamed for current stock. Keep a per-shipment-line
  -- snapshot so historic outbound documents retain the warehouse used then.
  UPDATE china_outbound_shipment_items AS shipment_item
  SET origin_warehouse_code = inventory.warehouse_code
  FROM saas_china_inventory AS inventory
  WHERE shipment_item.origin_warehouse_code IS NULL
    AND inventory.id = shipment_item.inventory_id
    AND inventory.user_id = shipment_item.user_id;
  UPDATE china_outbound_shipment_items AS shipment_item
  SET origin_warehouse_code = shipment.origin_warehouse_code
  FROM china_outbound_shipments AS shipment
  WHERE shipment_item.origin_warehouse_code IS NULL
    AND shipment.id = shipment_item.shipment_id
    AND shipment.user_id = shipment_item.user_id;
  UPDATE china_outbound_shipment_items
  SET origin_warehouse_code = 'default'
  WHERE origin_warehouse_code IS NULL;
  ALTER TABLE china_outbound_shipment_items
    ALTER COLUMN origin_warehouse_code SET DEFAULT 'default';
  ALTER TABLE china_outbound_shipment_items
    ALTER COLUMN origin_warehouse_code SET NOT NULL;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'china_outbound_shipment_items_box_split_status'
    ) THEN
      ALTER TABLE china_outbound_shipment_items
        ADD CONSTRAINT china_outbound_shipment_items_box_split_status
        CHECK (box_split_status IS NULL OR box_split_status IN ('in_progress', 'completed'));
    END IF;
  END $$;

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
    completion_status varchar(20),
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
    CONSTRAINT china_outbound_pallets_completion_status CHECK (
      completion_status IS NULL OR completion_status IN ('in_progress', 'completed')
    ),
    CONSTRAINT china_outbound_pallets_measurements_nonnegative CHECK (
      (gross_weight_kg IS NULL OR gross_weight_kg >= 0)
      AND (length_cm IS NULL OR length_cm >= 0)
      AND (width_cm IS NULL OR width_cm >= 0)
      AND (height_cm IS NULL OR height_cm >= 0)
    )
  );

  ALTER TABLE china_outbound_pallets
    ADD COLUMN IF NOT EXISTS completion_status varchar(20);
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'china_outbound_pallets_completion_status'
        AND conrelid = 'china_outbound_pallets'::regclass
    ) THEN
      ALTER TABLE china_outbound_pallets ADD CONSTRAINT china_outbound_pallets_completion_status
        CHECK (completion_status IS NULL OR completion_status IN ('in_progress', 'completed'));
    END IF;
  END $$;

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
    completion_status varchar(20),
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
    CONSTRAINT china_outbound_boxes_completion_status CHECK (
      completion_status IS NULL OR completion_status IN ('in_progress', 'completed')
    ),
    CONSTRAINT china_outbound_boxes_sort_nonnegative CHECK (sort_order >= 0),
    CONSTRAINT china_outbound_boxes_measurements_nonnegative CHECK (
      (gross_weight_kg IS NULL OR gross_weight_kg >= 0)
      AND (length_cm IS NULL OR length_cm >= 0)
      AND (width_cm IS NULL OR width_cm >= 0)
      AND (height_cm IS NULL OR height_cm >= 0)
    )
  );

  -- Existing deployments can have this isolated table from an earlier build
  -- without the physical-dimension fields. Keep the runtime bootstrap
  -- additive so CBM entry works without depending on a separate migration run.
  ALTER TABLE china_outbound_boxes
    ADD COLUMN IF NOT EXISTS length_cm numeric(12, 2),
    ADD COLUMN IF NOT EXISTS width_cm numeric(12, 2),
    ADD COLUMN IF NOT EXISTS height_cm numeric(12, 2),
    ADD COLUMN IF NOT EXISTS completion_status varchar(20);

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'china_outbound_boxes_completion_status'
        AND conrelid = 'china_outbound_boxes'::regclass
    ) THEN
      ALTER TABLE china_outbound_boxes ADD CONSTRAINT china_outbound_boxes_completion_status
        CHECK (completion_status IS NULL OR completion_status IN ('in_progress', 'completed'));
    END IF;
  END $$;

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

  -- These bridge tables are deliberately separate from the legacy Ecount
  -- China inventory. They only connect a user-opted-in purchase row to the
  -- already-isolated SaaS inventory and its outbound reservation.
  CREATE TABLE IF NOT EXISTS saas_china_purchase_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    inventory_id uuid NOT NULL,
    purchase_request_item_id uuid NOT NULL,
    received_quantity integer NOT NULL DEFAULT 0,
    reserved_quantity integer NOT NULL DEFAULT 0,
    dispatched_quantity integer NOT NULL DEFAULT 0,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT saas_china_purchase_links_id_user_key UNIQUE (id, user_id),
    CONSTRAINT saas_china_purchase_links_inventory_workspace_fkey
      FOREIGN KEY (inventory_id, user_id)
      REFERENCES saas_china_inventory(id, user_id)
      ON DELETE RESTRICT,
    CONSTRAINT saas_china_purchase_links_purchase_item_workspace_fkey
      FOREIGN KEY (purchase_request_item_id, user_id)
      REFERENCES purchase_request_items(id, user_id)
      ON DELETE RESTRICT,
    CONSTRAINT saas_china_purchase_links_received_nonnegative
      CHECK (received_quantity >= 0),
    CONSTRAINT saas_china_purchase_links_reserved_nonnegative
      CHECK (reserved_quantity >= 0),
    CONSTRAINT saas_china_purchase_links_dispatched_nonnegative
      CHECK (dispatched_quantity >= 0),
    CONSTRAINT saas_china_purchase_links_allocation_within_received
      CHECK (reserved_quantity + dispatched_quantity <= received_quantity)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS saas_china_purchase_links_user_purchase_item
    ON saas_china_purchase_links(user_id, purchase_request_item_id);
  CREATE INDEX IF NOT EXISTS saas_china_purchase_links_user_inventory_created
    ON saas_china_purchase_links(user_id, inventory_id, created_at, id);

  CREATE TABLE IF NOT EXISTS saas_china_shipment_purchase_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    shipment_id uuid NOT NULL,
    shipment_item_id uuid NOT NULL,
    purchase_link_id uuid NOT NULL,
    reserved_quantity integer NOT NULL,
    dispatched_quantity integer NOT NULL DEFAULT 0,
    released_quantity integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT saas_china_shipment_purchase_allocations_shipment_workspace_fkey
      FOREIGN KEY (shipment_id, user_id)
      REFERENCES china_outbound_shipments(id, user_id)
      ON DELETE RESTRICT,
    CONSTRAINT saas_china_shipment_purchase_allocations_shipment_item_workspace_fkey
      FOREIGN KEY (shipment_item_id, shipment_id, user_id)
      REFERENCES china_outbound_shipment_items(id, shipment_id, user_id)
      ON DELETE RESTRICT,
    CONSTRAINT saas_china_shipment_purchase_allocations_purchase_link_workspace_fkey
      FOREIGN KEY (purchase_link_id, user_id)
      REFERENCES saas_china_purchase_links(id, user_id)
      ON DELETE RESTRICT,
    CONSTRAINT saas_china_shipment_purchase_allocations_reserved_positive
      CHECK (reserved_quantity > 0),
    CONSTRAINT saas_china_shipment_purchase_allocations_dispatched_nonnegative
      CHECK (dispatched_quantity >= 0),
    CONSTRAINT saas_china_shipment_purchase_allocations_released_nonnegative
      CHECK (released_quantity >= 0),
    CONSTRAINT saas_china_shipment_purchase_allocations_resolved_within_reserved
      CHECK (dispatched_quantity + released_quantity <= reserved_quantity)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS saas_china_shipment_purchase_allocations_item_link
    ON saas_china_shipment_purchase_allocations(shipment_item_id, purchase_link_id);
  CREATE INDEX IF NOT EXISTS saas_china_shipment_purchase_allocations_user_shipment
    ON saas_china_shipment_purchase_allocations(user_id, shipment_id);
  CREATE INDEX IF NOT EXISTS saas_china_shipment_purchase_allocations_purchase_link
    ON saas_china_shipment_purchase_allocations(purchase_link_id);

  ALTER TABLE saas_china_inventory ENABLE ROW LEVEL SECURITY;
  ALTER TABLE saas_china_outbound_warehouses ENABLE ROW LEVEL SECURITY;
  ALTER TABLE saas_china_inventory_movements ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_shipments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_shipment_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_pallets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_boxes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE china_outbound_box_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE saas_china_purchase_links ENABLE ROW LEVEL SECURITY;
  ALTER TABLE saas_china_shipment_purchase_allocations ENABLE ROW LEVEL SECURITY;

  REVOKE ALL ON TABLE saas_china_inventory FROM anon, authenticated;
  REVOKE ALL ON TABLE saas_china_outbound_warehouses FROM anon, authenticated;
  REVOKE ALL ON TABLE saas_china_inventory_movements FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_shipments FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_shipment_items FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_pallets FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_boxes FROM anon, authenticated;
  REVOKE ALL ON TABLE china_outbound_box_items FROM anon, authenticated;
  REVOKE ALL ON TABLE saas_china_purchase_links FROM anon, authenticated;
  REVOKE ALL ON TABLE saas_china_shipment_purchase_allocations FROM anon, authenticated;
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
      .where(and(
        eq(saasChinaInventory.userId, userId),
        isNull(saasChinaInventory.archivedAt),
      ))
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
      .where(and(
        eq(saasChinaInventory.userId, userId),
        isNull(saasChinaInventory.archivedAt),
      )),
  ])

  return {
    items,
    summary: summary ?? { onHandQuantity: 0, reservedQuantity: 0, availableQuantity: 0 },
  }
}

/**
 * Lists configured outbound warehouses together with every active SaaS China
 * inventory warehouse. The catalog is seeded lazily so existing workspaces
 * immediately gain editable names without altering any stock records.
 */
export async function listSaasChinaOutboundWarehouses(userId: string): Promise<SaasChinaOutboundWarehouse[]> {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, userId)
    const catalog = await ensureSaasChinaOutboundWarehouseCatalog(tx, { userId })
    return catalog.warehouses
  })
}

/** Returns the workspace's default outbound warehouse name. */
export async function getSaasChinaDefaultWarehouseCode(userId: string) {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, userId)
    const catalog = await ensureSaasChinaOutboundWarehouseCatalog(tx, { userId })
    return catalog.defaultWarehouseCode
  })
}

export async function createSaasChinaOutboundWarehouse(input: {
  userId: string
  createdBy: string
  warehouseCode: string
}) {
  await ensureSaasChinaOutboundSchema()
  const warehouseCode = requiredWarehouseCode(input.warehouseCode, '새 출고창고명')
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const catalog = await ensureSaasChinaOutboundWarehouseCatalog(tx, input)
    if (catalog.warehouses.some((warehouse) => warehouse.warehouseCode === warehouseCode)) {
      throw new Error('이미 등록된 출고창고명입니다.')
    }
    const [warehouse] = await tx
      .insert(saasChinaOutboundWarehouses)
      .values({
        userId: input.userId,
        warehouseCode,
        isDefault: false,
        createdBy: input.createdBy,
      })
      .returning()
    if (!warehouse) throw new Error('출고창고를 추가하지 못했습니다.')
    return warehouse
  })
}

/**
 * Renames only the current active SaaS China stock location. Movement and
 * outbound history deliberately retain their original snapshots.
 */
export async function renameSaasChinaOutboundWarehouse(input: {
  userId: string
  createdBy: string
  warehouseCode: string
  nextWarehouseCode: string
}) {
  await ensureSaasChinaOutboundSchema()
  const warehouseCode = requiredWarehouseCode(input.warehouseCode, '현재 출고창고명')
  const nextWarehouseCode = requiredWarehouseCode(input.nextWarehouseCode, '새 출고창고명')
  if (warehouseCode === nextWarehouseCode) throw new Error('변경할 출고창고명이 같습니다.')

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const catalog = await ensureSaasChinaOutboundWarehouseCatalog(tx, input)
    const current = catalog.warehouses.find((warehouse) => warehouse.warehouseCode === warehouseCode)
    if (!current) throw new Error('수정할 출고창고를 찾을 수 없습니다.')
    if (catalog.warehouses.some((warehouse) => warehouse.warehouseCode === nextWarehouseCode)) {
      throw new Error('이미 등록된 출고창고명입니다.')
    }

    const [currentWarehouse] = await tx
      .select()
      .from(saasChinaOutboundWarehouses)
      .where(and(
        eq(saasChinaOutboundWarehouses.userId, input.userId),
        eq(saasChinaOutboundWarehouses.warehouseCode, warehouseCode),
      ))
      .limit(1)
    if (!currentWarehouse) throw new Error('수정할 출고창고를 찾을 수 없습니다.')

    const updatedAt = new Date()
    const updatedInventories = await tx
      .update(saasChinaInventory)
      .set({ warehouseCode: nextWarehouseCode, updatedAt })
      .where(and(
        eq(saasChinaInventory.userId, input.userId),
        isNull(saasChinaInventory.archivedAt),
        eq(saasChinaInventory.warehouseCode, warehouseCode),
      ))
      .returning({ id: saasChinaInventory.id })
    const [warehouse] = await tx
      .update(saasChinaOutboundWarehouses)
      .set({ warehouseCode: nextWarehouseCode, updatedAt })
      .where(eq(saasChinaOutboundWarehouses.id, currentWarehouse.id))
      .returning()
    if (!warehouse) throw new Error('출고창고명을 수정하지 못했습니다.')

    return {
      warehouse,
      renamedActiveInventoryCount: updatedInventories.length,
    }
  })
}

export async function listChinaOutboundShipments(
  userId: string,
  options: { includeCancelled?: boolean } = {},
) {
  await ensureSaasChinaOutboundSchema()
  const shipmentConditions = [eq(chinaOutboundShipments.userId, userId)]
  if (!options.includeCancelled) shipmentConditions.push(ne(chinaOutboundShipments.status, 'cancelled'))
  const [shipments, itemCounts] = await Promise.all([
    db
      .select()
      .from(chinaOutboundShipments)
      .where(and(...shipmentConditions))
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

  // New shipment rows carry their warehouse snapshot. Keep the inventory
  // lookup only as a compatibility fallback for rows created before that
  // column was introduced.
  const inventoryIds = [...new Set(items
    .filter((item) => !item.originWarehouseCode)
    .map((item) => item.inventoryId))]
  const inventoryRows = inventoryIds.length === 0
    ? []
    : await db
      .select({ id: saasChinaInventory.id, warehouseCode: saasChinaInventory.warehouseCode })
      .from(saasChinaInventory)
      .where(and(
        eq(saasChinaInventory.userId, input.userId),
        inArray(saasChinaInventory.id, inventoryIds),
      ))
  const warehouseCodeByInventoryId = new Map(inventoryRows.map((inventory) => [inventory.id, inventory.warehouseCode]))
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
    items: items.map((item) => ({
      ...item,
      warehouseCode: item.originWarehouseCode
        || warehouseCodeByInventoryId.get(item.inventoryId)
        || shipment.originWarehouseCode,
    })),
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
  assertSaasChinaInventoryWarehouseAllowed(warehouseCode)
  const optionName = optionalText(input.optionName)
  const optionKey = optionName ?? ''

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const [existing] = await tx
      .select()
      .from(saasChinaInventory)
      .where(and(
        eq(saasChinaInventory.userId, input.userId),
        isNull(saasChinaInventory.archivedAt),
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
          archivedAt: null,
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
    // A manual adjustment may reduce only the unlinked/manual balance. It
    // must not silently consume inventory that is still traceable to an
    // opt-in purchase lot, otherwise a later shipment could allocate stock
    // that was manually removed.
    const linkedOnHand = await getSaasChinaPurchaseLinkedOnHand(tx, input.userId, inventory.id)
    if (afterOnHand < linkedOnHand) {
      throw new Error(`발주 연동 재고 ${linkedOnHand.toLocaleString('ko-KR')}개를 제외한 수량만 조정할 수 있습니다.`)
    }

    const afterAvailable = afterOnHand - inventory.reservedQuantity
    const [updated] = await tx
      .update(saasChinaInventory)
      .set({
        onHandQuantity: afterOnHand,
        availableQuantity: afterAvailable,
        archivedAt: delta > 0 ? null : inventory.archivedAt,
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

/**
 * The production Excel route always requests a full snapshot replacement.
 * Keeping the optional patch mode here preserves the lower-level service for
 * callers that explicitly need a reviewed, non-destructive adjustment.
 */
export async function previewSaasChinaInventoryWorkbook(input: {
  userId: string
  rows: readonly SaasChinaInventoryExcelRow[]
  fullSnapshot?: boolean
  snapshotWarehouseCodes?: readonly string[]
}): Promise<SaasChinaInventoryWorkbookPreview> {
  await ensureSaasChinaOutboundSchema()
  const [inventories, linkedBalances] = await Promise.all([
    db
      .select()
      .from(saasChinaInventory)
      .where(eq(saasChinaInventory.userId, input.userId)),
    db
      .select({
        inventoryId: saasChinaPurchaseLinks.inventoryId,
        linkedOnHand: sql<number>`COALESCE(SUM(${saasChinaPurchaseLinks.receivedQuantity} - ${saasChinaPurchaseLinks.dispatchedQuantity}), 0)::int`,
      })
      .from(saasChinaPurchaseLinks)
      .where(eq(saasChinaPurchaseLinks.userId, input.userId))
      .groupBy(saasChinaPurchaseLinks.inventoryId),
  ])
  return buildSaasChinaInventoryWorkbookPreview({
    userId: input.userId,
    rows: input.rows,
    inventories,
    linkedOnHandByInventoryId: new Map(linkedBalances.map((row) => [row.inventoryId, row.linkedOnHand ?? 0])),
    fullSnapshot: input.fullSnapshot,
    snapshotWarehouseCodes: input.snapshotWarehouseCodes,
  })
}

/**
 * Applies a reviewed workbook as one transaction. A full snapshot retires the
 * entire active list first, then creates a fresh active row for every workbook
 * identity. Historical rows remain archived only because immutable movement,
 * outbound, and purchase records still point at them.
 */
export async function applySaasChinaInventoryWorkbook(input: {
  userId: string
  createdBy: string
  rows: readonly SaasChinaInventoryExcelRow[]
  sourceLabel?: string | null
  fullSnapshot?: boolean
  snapshotWarehouseCodes?: readonly string[]
}): Promise<SaasChinaInventoryWorkbookApplyResult> {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const [inventories, linkedBalances] = await Promise.all([
      tx
        .select()
        .from(saasChinaInventory)
        .where(eq(saasChinaInventory.userId, input.userId)),
      tx
        .select({
          inventoryId: saasChinaPurchaseLinks.inventoryId,
          linkedOnHand: sql<number>`COALESCE(SUM(${saasChinaPurchaseLinks.receivedQuantity} - ${saasChinaPurchaseLinks.dispatchedQuantity}), 0)::int`,
        })
        .from(saasChinaPurchaseLinks)
        .where(eq(saasChinaPurchaseLinks.userId, input.userId))
        .groupBy(saasChinaPurchaseLinks.inventoryId),
    ])
    const preview = buildSaasChinaInventoryWorkbookPreview({
      userId: input.userId,
      rows: input.rows,
      inventories,
      linkedOnHandByInventoryId: new Map(linkedBalances.map((row) => [row.inventoryId, row.linkedOnHand ?? 0])),
      fullSnapshot: input.fullSnapshot,
      snapshotWarehouseCodes: input.snapshotWarehouseCodes,
    })
    if (preview.summary.invalidCount > 0) {
      throw new Error(preview.errors?.[0] ?? '엑셀 오류를 먼저 수정해주세요.')
    }

    if (input.fullSnapshot) {
      const plansByWorkbookIdentity = new Map(preview.rows.flatMap((row) => row.row == null ? [] : [[
        saasChinaInventoryWorkbookPlanKey(row.row, row.warehouseCode, row.sku, row.optionName),
        row,
      ] as const]))
      const snapshotWarehouseCodeList = (input.snapshotWarehouseCodes ?? [])
        .map((warehouseCode) => warehouseCode.trim())
        .filter(Boolean)
      const snapshotWarehouseCodes = snapshotWarehouseCodeList.length > 0
        ? new Set(snapshotWarehouseCodeList)
        : null
      const activeInventories = inventories.filter((inventory) => (
        inventory.archivedAt == null
        && (snapshotWarehouseCodes == null || snapshotWarehouseCodes.has(inventory.warehouseCode))
      ))
      const activeInventoryWhere = snapshotWarehouseCodes == null
        ? and(
          eq(saasChinaInventory.userId, input.userId),
          isNull(saasChinaInventory.archivedAt),
        )
        : and(
          eq(saasChinaInventory.userId, input.userId),
          isNull(saasChinaInventory.archivedAt),
          inArray(saasChinaInventory.warehouseCode, [...snapshotWarehouseCodes]),
        )
      const replacementAt = new Date()
      const batchId = randomUUID()
      const retired = activeInventories.length === 0
        ? []
        : await tx
          .update(saasChinaInventory)
          .set({ archivedAt: replacementAt, updatedAt: replacementAt })
          .where(activeInventoryWhere)
          .returning({ id: saasChinaInventory.id })

      let createdCount = 0
      for (const [rowIndex, rawRow] of input.rows.entries()) {
        const row = normalizeSaasChinaInventoryWorkbookRow(rawRow)
        const plan = plansByWorkbookIdentity.get(
          saasChinaInventoryWorkbookPlanKey(row.rowNumber, row.warehouseCode, row.sku, row.optionName),
        )
        if (!plan || plan.status !== 'new') continue
        const targetOnHand = plan.afterQuantity
        if (!row.productName || targetOnHand == null || targetOnHand <= 0) {
          throw new Error(`${row.rowNumber}행의 새 SaaS 중국재고 정보를 확인해주세요.`)
        }

        const [created] = await tx
          .insert(saasChinaInventory)
          .values({
            userId: input.userId,
            warehouseCode: row.warehouseCode,
            sku: row.sku,
            productName: row.productName,
            itemCategory: row.itemCategory,
            optionKey: row.optionKey,
            optionName: row.optionName,
            onHandQuantity: targetOnHand,
            reservedQuantity: 0,
            availableQuantity: targetOnHand,
            lastReceivedAt: replacementAt,
            createdBy: input.createdBy,
          })
          .returning()
        if (!created) throw new Error('SaaS 중국재고를 저장하지 못했습니다.')
        await insertSaasChinaInventoryMovement(tx, {
          inventoryId: created.id,
          userId: input.userId,
          movementType: 'opening_balance',
          onHandDelta: targetOnHand,
          reservedDelta: 0,
          onHandBefore: 0,
          reservedBefore: 0,
          onHandAfter: targetOnHand,
          reservedAfter: 0,
          sourceKey: `saas-china-excel:${batchId}:${row.rowNumber}:${rowIndex + 1}`,
          note: row.note ?? excelInventoryNote(input.sourceLabel),
          createdBy: input.createdBy,
        })
        createdCount += 1
      }

      return {
        createdCount,
        updatedCount: 0,
        archivedCount: retired.length,
        unchangedCount: 0,
      }
    }

    const inventoriesByIdentity = new Map(inventories.map((inventory) => [
      saasChinaInventoryIdentityKey(inventory.warehouseCode, inventory.sku, inventory.optionKey),
      inventory,
    ]))
    const inventoriesById = new Map(inventories.map((inventory) => [inventory.id, inventory]))
    // An inventory-status workbook can expand one physical Excel row into
    // multiple warehouse identities. A row number alone is therefore not a
    // sufficient apply-plan key.
    const plansByWorkbookIdentity = new Map(preview.rows.flatMap((row) => row.row == null ? [] : [[
      saasChinaInventoryWorkbookPlanKey(row.row, row.warehouseCode, row.sku, row.optionName),
      row,
    ] as const]))
    const batchId = randomUUID()
    let createdCount = 0
    let updatedCount = 0
    let archivedCount = 0

    for (const [rowIndex, rawRow] of input.rows.entries()) {
      const row = normalizeSaasChinaInventoryWorkbookRow(rawRow)
      const plan = plansByWorkbookIdentity.get(
        saasChinaInventoryWorkbookPlanKey(row.rowNumber, row.warehouseCode, row.sku, row.optionName),
      )
      if (!plan || plan.status === 'unchanged') continue
      // Invalid/protected rows were rejected above; retaining this guard means a
      // future caller cannot partially apply a plan that was not validated.
      if (plan.status === 'invalid' || plan.status === 'protected') {
        throw new Error(plan.message ?? '엑셀 오류를 먼저 수정해주세요.')
      }

      const identity = saasChinaInventoryIdentityKey(row.warehouseCode, row.sku, row.optionKey)
      const existing = row.inventoryId
        ? inventoriesById.get(row.inventoryId)
        : inventoriesByIdentity.get(identity)
      const targetOnHand = plan.afterQuantity
      if (targetOnHand == null) throw new Error(`${row.rowNumber}행의 현재고를 확인해주세요.`)

      if (!existing) {
        const productName = row.productName
        if (!productName || targetOnHand < 0 || (targetOnHand === 0 && !input.fullSnapshot)) {
          throw new Error(`${row.rowNumber}행의 새 SaaS 중국재고 정보를 확인해주세요.`)
        }
        const [created] = await tx
          .insert(saasChinaInventory)
          .values({
            userId: input.userId,
            warehouseCode: row.warehouseCode,
            sku: row.sku,
            productName,
            itemCategory: row.itemCategory,
            optionKey: row.optionKey,
            optionName: row.optionName,
            onHandQuantity: targetOnHand,
            reservedQuantity: 0,
            availableQuantity: targetOnHand,
            lastReceivedAt: targetOnHand > 0 ? new Date() : null,
            createdBy: input.createdBy,
          })
          .returning()
        if (!created) throw new Error('SaaS 중국재고를 저장하지 못했습니다.')
        await insertSaasChinaInventoryMovement(tx, {
          inventoryId: created.id,
          userId: input.userId,
          movementType: 'opening_balance',
          onHandDelta: targetOnHand,
          reservedDelta: 0,
          onHandBefore: 0,
          reservedBefore: 0,
          onHandAfter: targetOnHand,
          reservedAfter: 0,
          sourceKey: `saas-china-excel:${batchId}:${row.rowNumber}:${rowIndex + 1}`,
          note: row.note ?? excelInventoryNote(input.sourceLabel),
          createdBy: input.createdBy,
        })
        inventoriesByIdentity.set(identity, created)
        inventoriesById.set(created.id, created)
        createdCount += 1
        continue
      }

      const nextProductName = row.productName ?? existing.productName
      const nextItemCategory = row.itemCategory ?? existing.itemCategory
      const delta = targetOnHand - existing.onHandQuantity
      const afterAvailable = targetOnHand - existing.reservedQuantity
      const [updated] = await tx
        .update(saasChinaInventory)
        .set({
          productName: nextProductName,
          itemCategory: nextItemCategory,
          onHandQuantity: targetOnHand,
          availableQuantity: afterAvailable,
          archivedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(saasChinaInventory.id, existing.id))
        .returning()
      if (!updated) throw new Error('SaaS 중국재고 변경에 실패했습니다.')
      if (delta !== 0) {
        await insertSaasChinaInventoryMovement(tx, {
          inventoryId: existing.id,
          userId: input.userId,
          movementType: 'manual_adjustment',
          onHandDelta: delta,
          reservedDelta: 0,
          onHandBefore: existing.onHandQuantity,
          reservedBefore: existing.reservedQuantity,
          onHandAfter: targetOnHand,
          reservedAfter: existing.reservedQuantity,
          sourceKey: `saas-china-excel:${batchId}:${row.rowNumber}:${rowIndex + 1}`,
          note: row.note ?? excelInventoryNote(input.sourceLabel),
          createdBy: input.createdBy,
        })
      }
      inventoriesByIdentity.set(identity, updated)
      inventoriesById.set(updated.id, updated)
      updatedCount += 1
    }

    for (const plan of preview.rows) {
      if (plan.status !== 'removed' || !plan.inventoryId) continue
      const existing = inventoriesById.get(plan.inventoryId)
      if (!existing) throw new Error('목록에서 제거할 SaaS 중국재고를 찾을 수 없습니다.')

      const delta = -existing.onHandQuantity
      const [archived] = await tx
        .update(saasChinaInventory)
        .set({
          onHandQuantity: 0,
          availableQuantity: 0,
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(saasChinaInventory.id, existing.id),
          eq(saasChinaInventory.userId, input.userId),
        ))
        .returning()
      if (!archived) throw new Error('SaaS 중국재고를 목록에서 제거하지 못했습니다.')
      if (delta !== 0) {
        await insertSaasChinaInventoryMovement(tx, {
          inventoryId: existing.id,
          userId: input.userId,
          movementType: 'manual_adjustment',
          onHandDelta: delta,
          reservedDelta: 0,
          onHandBefore: existing.onHandQuantity,
          reservedBefore: existing.reservedQuantity,
          onHandAfter: 0,
          reservedAfter: existing.reservedQuantity,
          sourceKey: `saas-china-excel-snapshot-remove:${batchId}:${existing.id}`,
          note: `${excelInventoryNote(input.sourceLabel)} (재고현황 파일에 없음)`,
          createdBy: input.createdBy,
        })
      }
      inventoriesById.set(archived.id, archived)
      inventoriesByIdentity.set(saasChinaInventoryIdentityKey(archived.warehouseCode, archived.sku, archived.optionKey), archived)
      archivedCount += 1
    }

    return {
      createdCount,
      updatedCount,
      archivedCount,
      unchangedCount: preview.summary.unchangedCount,
    }
  })
}

/**
 * Creates the traceable SaaS inventory lot for one opt-in purchase row. This
 * is intentionally transaction-only: the purchase status update owns the
 * outer transaction so a legacy inventory write can never slip in between.
 */
export async function receiveSaasChinaPurchaseArrivalInTransaction(
  tx: DbTransaction,
  input: SaasChinaPurchaseArrivalInput,
) {
  const quantity = positiveInteger(input.quantity, '중국도착 수량')
  const sku = requiredText(input.sku, '품목코드')
  const productName = requiredText(input.productName, '상품명')
  const requestedWarehouseCode = input.warehouseCode == null
    ? null
    : requiredWarehouseCode(input.warehouseCode, '중국창고')
  const optionName = optionalText(input.optionName)
  const optionKey = optionName ?? ''

  await lockSaasChinaOutboundWorkspace(tx, input.userId)
  const [existingLink] = await tx
    .select()
    .from(saasChinaPurchaseLinks)
    .where(and(
      eq(saasChinaPurchaseLinks.userId, input.userId),
      eq(saasChinaPurchaseLinks.purchaseRequestItemId, input.purchaseRequestItemId),
    ))
    .limit(1)

  if (existingLink) {
    const inventory = await getSaasChinaInventoryForUpdate(tx, input.userId, existingLink.inventoryId)
    return { inventory, link: existingLink, created: false }
  }

  const warehouseCode = requestedWarehouseCode
    ? requestedWarehouseCode
    : (await ensureSaasChinaOutboundWarehouseCatalog(tx, input)).defaultWarehouseCode

  const [existingInventory] = await tx
    .select()
    .from(saasChinaInventory)
    .where(and(
      eq(saasChinaInventory.userId, input.userId),
      isNull(saasChinaInventory.archivedAt),
      eq(saasChinaInventory.warehouseCode, warehouseCode),
      eq(saasChinaInventory.sku, sku),
      eq(saasChinaInventory.optionKey, optionKey),
    ))
    .limit(1)

  const beforeOnHand = existingInventory?.onHandQuantity ?? 0
  const beforeReserved = existingInventory?.reservedQuantity ?? 0
  const afterOnHand = beforeOnHand + quantity
  const afterAvailable = afterOnHand - beforeReserved
  const inventory = existingInventory
    ? (await tx
      .update(saasChinaInventory)
      .set({
        productName,
        optionName,
        onHandQuantity: afterOnHand,
        availableQuantity: afterAvailable,
        lastReceivedAt: new Date(),
        archivedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(saasChinaInventory.id, existingInventory.id))
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
        reservedQuantity: beforeReserved,
        availableQuantity: afterAvailable,
        lastReceivedAt: new Date(),
        createdBy: input.createdBy,
      })
      .returning())[0]
  if (!inventory) throw new Error('발주 연동 SaaS 중국재고를 저장하지 못했습니다.')

  await insertSaasChinaInventoryMovement(tx, {
    inventoryId: inventory.id,
    userId: input.userId,
    movementType: 'arrival',
    onHandDelta: quantity,
    reservedDelta: 0,
    onHandBefore: beforeOnHand,
    reservedBefore: beforeReserved,
    onHandAfter: afterOnHand,
    reservedAfter: beforeReserved,
    sourceKey: `saas-china-purchase-arrival:${input.purchaseRequestItemId}`,
    note: '발주 중국창고도착 연동',
    createdBy: input.createdBy,
  })

  const [link] = await tx
    .insert(saasChinaPurchaseLinks)
    .values({
      userId: input.userId,
      inventoryId: inventory.id,
      purchaseRequestItemId: input.purchaseRequestItemId,
      receivedQuantity: quantity,
      createdBy: input.createdBy,
    })
    .returning()
  if (!link) throw new Error('발주와 SaaS 중국재고 연결을 저장하지 못했습니다.')

  await reconcileSaasChinaPurchaseLinks(tx, input.userId, [link.id])
  return { inventory, link, created: true }
}

/** Adjusts a received quantity while preserving every existing reservation. */
export async function adjustSaasChinaPurchaseArrivalQuantityInTransaction(input: {
  tx: DbTransaction
  userId: string
  createdBy: string
  purchaseRequestItemId: string
  quantity: number
}) {
  const quantity = nonNegativeInteger(input.quantity, '중국도착 수량')
  await lockSaasChinaOutboundWorkspace(input.tx, input.userId)
  const link = await getSaasChinaPurchaseLinkForUpdate(
    input.tx,
    input.userId,
    input.purchaseRequestItemId,
  )
  const difference = quantity - link.receivedQuantity
  if (difference === 0) return link
  if (quantity < link.reservedQuantity + link.dispatchedQuantity) {
    throw new Error('이미 출고 예약 또는 완료된 수량보다 중국도착수량을 적게 줄일 수 없습니다.')
  }

  const inventory = await getSaasChinaInventoryForUpdate(input.tx, input.userId, link.inventoryId)
  const afterOnHand = inventory.onHandQuantity + difference
  if (afterOnHand < inventory.reservedQuantity) {
    throw new Error('현재 SaaS 중국재고의 출고 예약 수량보다 적게 줄일 수 없습니다.')
  }
  if (difference < 0 && inventory.availableQuantity < Math.abs(difference)) {
    throw new Error('다른 출고작업에 사용할 수 있는 SaaS 중국재고보다 적게 줄일 수 없습니다.')
  }

  const afterAvailable = afterOnHand - inventory.reservedQuantity
  const [updatedInventory] = await input.tx
    .update(saasChinaInventory)
    .set({
      onHandQuantity: afterOnHand,
      availableQuantity: afterAvailable,
      lastReceivedAt: difference > 0 ? new Date() : inventory.lastReceivedAt,
      archivedAt: difference > 0 ? null : inventory.archivedAt,
      updatedAt: new Date(),
    })
    .where(eq(saasChinaInventory.id, inventory.id))
    .returning()
  if (!updatedInventory) throw new Error('SaaS 중국재고 도착수량을 조정하지 못했습니다.')

  const [updatedLink] = await input.tx
    .update(saasChinaPurchaseLinks)
    .set({ receivedQuantity: quantity, updatedAt: new Date() })
    .where(eq(saasChinaPurchaseLinks.id, link.id))
    .returning()
  if (!updatedLink) throw new Error('발주 연동 도착수량을 조정하지 못했습니다.')

  await insertSaasChinaInventoryMovement(input.tx, {
    inventoryId: inventory.id,
    userId: input.userId,
    movementType: 'manual_adjustment',
    onHandDelta: difference,
    reservedDelta: 0,
    onHandBefore: inventory.onHandQuantity,
    reservedBefore: inventory.reservedQuantity,
    onHandAfter: afterOnHand,
    reservedAfter: inventory.reservedQuantity,
    sourceKey: `saas-china-purchase-arrival-adjust:${input.purchaseRequestItemId}:${randomUUID()}`,
    note: '발주 중국도착수량 수정',
    createdBy: input.createdBy,
  })
  await reconcileSaasChinaPurchaseLinks(input.tx, input.userId, [link.id])
  return updatedLink
}

export async function hasSaasChinaPurchaseLinkInTransaction(input: {
  tx: DbTransaction
  userId: string
  purchaseRequestItemId: string
}) {
  const [link] = await input.tx
    .select({ id: saasChinaPurchaseLinks.id })
    .from(saasChinaPurchaseLinks)
    .where(and(
      eq(saasChinaPurchaseLinks.userId, input.userId),
      eq(saasChinaPurchaseLinks.purchaseRequestItemId, input.purchaseRequestItemId),
    ))
    .limit(1)
  return Boolean(link)
}

export async function createChinaOutboundShipment(
  input: CreateChinaOutboundShipmentInput,
  options: ChinaOutboundShipmentCreationOptions = {},
) {
  await ensureSaasChinaOutboundSchema()
  const normalizedLines = normalizeShipmentLines(input.lines)
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipmentNo = optionalText(input.shipmentNo) ?? createShipmentNo()
    if (options.idempotentShipmentNo) {
      const [existing] = await tx
        .select()
        .from(chinaOutboundShipments)
        .where(and(
          eq(chinaOutboundShipments.userId, input.userId),
          eq(chinaOutboundShipments.shipmentNo, shipmentNo),
        ))
        .limit(1)
      if (existing) {
        if (!options.idempotencyFingerprint || existing.externalReference === options.idempotencyFingerprint) return existing
        throw new Error('엑셀등록번호가 이미 다른 중국출고에 사용되었습니다. 새 양식을 내려받아 다시 등록해주세요.')
      }
    }
    const inventoryIds = normalizedLines.map((line) => line.inventoryId)
    const inventories = await tx
      .select()
      .from(saasChinaInventory)
      .where(and(
        eq(saasChinaInventory.userId, input.userId),
        isNull(saasChinaInventory.archivedAt),
        inArray(saasChinaInventory.id, inventoryIds),
      ))
    if (inventories.length !== inventoryIds.length) {
      throw new Error('SaaS 중국재고에서 찾을 수 없는 출고 품목이 있습니다.')
    }

    const inventoriesById = new Map(inventories.map((inventory) => [inventory.id, inventory]))
    for (const line of normalizedLines) {
      const inventory = inventoriesById.get(line.inventoryId)
      if (!inventory) throw new Error('SaaS 중국재고를 찾을 수 없습니다.')
      if (line.quantity > inventory.availableQuantity) {
        throw new Error(`${inventory.sku}의 작업 가능 수량은 ${inventory.availableQuantity.toLocaleString('ko-KR')}개입니다.`)
      }
    }

    const [shipment] = await tx
      .insert(chinaOutboundShipments)
      .values({
        userId: input.userId,
        displayName: optionalText(input.displayName),
        shipmentNo,
        status: 'draft',
        originWarehouseCode: getChinaOutboundOriginWarehouseCode(inventories.map((inventory) => inventory.warehouseCode)),
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

    const affectedPurchaseLinkIds = new Set<string>()
    const shipmentItems: ChinaOutboundShipmentItemRow[] = []
    for (const [index, line] of normalizedLines.entries()) {
      const inventory = inventoriesById.get(line.inventoryId)!
      const [shipmentItem] = await tx
        .insert(chinaOutboundShipmentItems)
        .values({
          shipmentId: shipment.id,
          inventoryId: inventory.id,
          userId: input.userId,
          sku: inventory.sku,
          productName: inventory.productName,
          optionKey: inventory.optionKey,
          optionName: inventory.optionName,
          originWarehouseCode: inventory.warehouseCode,
          reservedQuantity: line.quantity,
          sortOrder: index,
        })
        .returning()
      if (!shipmentItem) throw new Error('중국출고 상품을 저장하지 못했습니다.')
      shipmentItems.push(shipmentItem)

      const allocatedPurchaseLinkIds = await reserveSaasChinaPurchaseLotsForShipmentItem(tx, {
        userId: input.userId,
        shipmentId: shipment.id,
        shipmentItemId: shipmentItem.id,
        inventoryId: inventory.id,
        quantity: line.quantity,
      })
      allocatedPurchaseLinkIds.forEach((id) => affectedPurchaseLinkIds.add(id))

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

    await reconcileSaasChinaPurchaseLinks(tx, input.userId, [...affectedPurchaseLinkIds])
    await options.afterCreateInTransaction?.({ tx, shipment, shipmentItems })

    return shipment
  })
}

/**
 * Reviews a new China-outbound workbook against the current SaaS China stock.
 * Parsing errors are preserved here so the API can show one unified result.
 */
export async function previewChinaOutboundRegistrationWorkbook(input: {
  userId: string
  workbook: ChinaOutboundRegistrationWorkbook
}): Promise<ChinaOutboundRegistrationWorkbookPreview> {
  await ensureSaasChinaOutboundSchema()
  const fingerprint = createChinaOutboundRegistrationWorkbookFingerprint(input.workbook)
  const existing = (await findChinaOutboundShipmentByNumber(input.userId, input.workbook.importKey))[0] ?? null
  if (existing) {
    const isMatchingRetry = existing.externalReference === fingerprint
    const errors = isMatchingRetry
      ? input.workbook.errors
      : [...input.workbook.errors, {
        sheet: '출고정보',
        row: 2,
        message: '엑셀등록번호가 이미 다른 중국출고에 사용되었습니다. 새 양식을 내려받아 다시 등록해주세요.',
      }]
    return {
      summary: chinaOutboundRegistrationWorkbookSummary(input.workbook, errors.length),
      errors,
      existingShipmentId: existing.id,
      existingShipmentNo: existing.shipmentNo,
      alreadyRegistered: isMatchingRetry,
    }
  }
  const inventories = await listActiveSaasChinaInventoryForRegistration(input.userId)
  const validation = validateChinaOutboundRegistrationWorkbook(input.workbook, inventories)
  return {
    summary: chinaOutboundRegistrationWorkbookSummary(input.workbook, validation.errors.length),
    errors: validation.errors,
    existingShipmentId: null,
    existingShipmentNo: null,
    alreadyRegistered: false,
  }
}

/**
 * Creates the reservation and (when entered) all box/pallet rows in the same
 * transaction. An invalid box sheet can therefore never leave an orphaned
 * stock reservation behind.
 */
export async function applyChinaOutboundRegistrationWorkbook(input: {
  userId: string
  createdBy: string
  workbook: ChinaOutboundRegistrationWorkbook
}): Promise<ChinaOutboundRegistrationWorkbookApplyResult> {
  await ensureSaasChinaOutboundSchema()
  if (input.workbook.errors.length > 0) {
    throw new Error('엑셀 오류를 먼저 수정해주세요.')
  }
  const fingerprint = createChinaOutboundRegistrationWorkbookFingerprint(input.workbook)
  const existingRows = await findChinaOutboundShipmentByNumber(input.userId, input.workbook.importKey)
  const existing = existingRows[0]
  if (existing) {
    if (existing.externalReference === fingerprint) {
      return { shipmentId: existing.id, shipmentNo: existing.shipmentNo, created: false }
    }
    throw new Error('엑셀등록번호가 이미 다른 중국출고에 사용되었습니다. 새 양식을 내려받아 다시 등록해주세요.')
  }

  const inventories = await listActiveSaasChinaInventoryForRegistration(input.userId)
  const validation = validateChinaOutboundRegistrationWorkbook(input.workbook, inventories)
  if (validation.errors.length > 0) {
    throw new Error('엑셀 오류를 먼저 수정해주세요.')
  }
  if (!input.workbook.destinationName) {
    throw new Error('도착지를 입력해주세요.')
  }

  let created = false
  const shipment = await createChinaOutboundShipment({
    userId: input.userId,
    createdBy: input.createdBy,
    shipmentNo: input.workbook.importKey,
    externalReference: fingerprint,
    displayName: input.workbook.displayName,
    destinationName: input.workbook.destinationName,
    plannedOutboundDate: input.workbook.plannedOutboundDate,
    memo: input.workbook.memo,
    lines: validation.resolvedLines.map(({ inventory, item }) => ({
      inventoryId: inventory.id,
      quantity: item.quantity,
    })),
  }, {
    idempotentShipmentNo: true,
    idempotencyFingerprint: fingerprint,
    afterCreateInTransaction: async (context) => {
      created = true
      await saveChinaOutboundRegistrationPackingInTransaction({
        tx: context.tx,
        userId: input.userId,
        shipment: context.shipment,
        shipmentItems: context.shipmentItems,
        workbook: input.workbook,
        resolvedLines: validation.resolvedLines,
      })
    },
  })

  return { shipmentId: shipment.id, shipmentNo: shipment.shipmentNo, created }
}

type ChinaOutboundRegistrationResolvedLine = {
  item: ChinaOutboundRegistrationWorkbook['items'][number]
  inventory: typeof saasChinaInventory.$inferSelect
}

function chinaOutboundRegistrationWorkbookSummary(
  workbook: ChinaOutboundRegistrationWorkbook,
  invalidCount: number,
) {
  return {
    itemCount: workbook.items.length,
    boxCount: new Set(workbook.boxAllocations.map((allocation) => allocation.boxNo)).size,
    palletCount: new Set(workbook.boxAllocations.flatMap((allocation) => allocation.palletNo ? [allocation.palletNo] : [])).size,
    totalQuantity: workbook.items.reduce((total, item) => total + item.quantity, 0),
    invalidCount,
  }
}

async function listActiveSaasChinaInventoryForRegistration(userId: string) {
  return db
    .select()
    .from(saasChinaInventory)
    .where(and(
      eq(saasChinaInventory.userId, userId),
      isNull(saasChinaInventory.archivedAt),
    ))
}

async function findChinaOutboundShipmentByNumber(userId: string, shipmentNo: string) {
  const normalizedShipmentNo = optionalText(shipmentNo)
  if (!normalizedShipmentNo) return []
  return db
    .select({
      id: chinaOutboundShipments.id,
      shipmentNo: chinaOutboundShipments.shipmentNo,
      externalReference: chinaOutboundShipments.externalReference,
    })
    .from(chinaOutboundShipments)
    .where(and(
      eq(chinaOutboundShipments.userId, userId),
      eq(chinaOutboundShipments.shipmentNo, normalizedShipmentNo),
    ))
    .limit(1)
}

function validateChinaOutboundRegistrationWorkbook(
  workbook: ChinaOutboundRegistrationWorkbook,
  inventories: readonly (typeof saasChinaInventory.$inferSelect)[],
) {
  const errors = [...workbook.errors]
  const inventoriesByIdentity = new Map<string, Array<(typeof saasChinaInventory.$inferSelect)>>()
  for (const inventory of inventories) {
    const key = chinaOutboundRegistrationSourceKey(inventory.warehouseCode, inventory.sku, inventory.optionKey)
    inventoriesByIdentity.set(key, [...(inventoriesByIdentity.get(key) ?? []), inventory])
  }
  const resolvedLines: ChinaOutboundRegistrationResolvedLine[] = []
  for (const item of workbook.items) {
    if (isSaasChinaInventoryExcludedWarehouseCode(item.warehouseCode)) {
      errors.push({ sheet: '출고상품', row: item.rowNumber, message: SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_ERROR })
      continue
    }
    const matches = inventoriesByIdentity.get(chinaOutboundRegistrationSourceKey(
      item.warehouseCode,
      item.sku,
      item.optionName ?? '',
    )) ?? []
    if (matches.length === 0) {
      errors.push({ sheet: '출고상품', row: item.rowNumber, message: '현재 SaaS 중국재고에서 일치하는 출고상품을 찾을 수 없습니다.' })
      continue
    }
    if (matches.length > 1) {
      errors.push({ sheet: '출고상품', row: item.rowNumber, message: '현재 SaaS 중국재고에 같은 출고상품이 여러 개 있습니다. 재고를 정리한 뒤 다시 시도해주세요.' })
      continue
    }
    const inventory = matches[0]!
    if (item.quantity > inventory.availableQuantity) {
      errors.push({
        sheet: '출고상품',
        row: item.rowNumber,
        message: `${item.sku}의 작업 가능 수량은 ${inventory.availableQuantity.toLocaleString('ko-KR')}개입니다.`,
      })
      continue
    }
    resolvedLines.push({ item, inventory })
  }
  return { errors, resolvedLines }
}

async function saveChinaOutboundRegistrationPackingInTransaction(input: {
  tx: DbTransaction
  userId: string
  shipment: ChinaOutboundShipmentRow
  shipmentItems: ChinaOutboundShipmentItemRow[]
  workbook: ChinaOutboundRegistrationWorkbook
  resolvedLines: ChinaOutboundRegistrationResolvedLine[]
}) {
  if (input.workbook.boxAllocations.length === 0) return

  const inventoryIdBySource = new Map(input.resolvedLines.map(({ item, inventory }) => [
    chinaOutboundRegistrationSourceKey(item.warehouseCode, item.sku, item.optionName ?? ''),
    inventory.id,
  ]))
  const allocationsByInventoryId = new Map<string, ChinaOutboundBoxSplitInput[]>()
  const palletAssignmentsByBox = new Map<string, string | null>()
  for (const allocation of input.workbook.boxAllocations) {
    const inventoryId = inventoryIdBySource.get(chinaOutboundRegistrationSourceKey(
      allocation.warehouseCode,
      allocation.sku,
      allocation.optionName ?? '',
    ))
    if (!inventoryId) {
      throw new Error('박스 쉽먼트의 출고상품을 현재 재고에서 찾을 수 없습니다.')
    }
    allocationsByInventoryId.set(inventoryId, [
      ...(allocationsByInventoryId.get(inventoryId) ?? []),
      {
        boxNo: allocation.boxNo,
        quantity: allocation.quantity,
        lengthCm: allocation.lengthCm,
        widthCm: allocation.widthCm,
        heightCm: allocation.heightCm,
      },
    ])
    palletAssignmentsByBox.set(allocation.boxNo, allocation.palletNo)
  }

  const shipmentItemsByInventoryId = new Map(input.shipmentItems.map((item) => [item.inventoryId, item]))
  let boxes: ChinaOutboundBoxRow[] = []
  let boxItems: ChinaOutboundBoxItemRow[] = []
  for (const { inventory } of input.resolvedLines) {
    const shipmentItem = shipmentItemsByInventoryId.get(inventory.id)
    const allocations = allocationsByInventoryId.get(inventory.id)
    if (!shipmentItem || !allocations || allocations.length === 0) {
      throw new Error('박스 쉽먼트의 출고상품과 출고수량을 확인해주세요.')
    }
    const result = await replaceChinaOutboundItemBoxSplitsInTransaction({
      tx: input.tx,
      userId: input.userId,
      shipment: input.shipment,
      shipmentItem,
      allocations,
      boxSplitStatus: 'completed',
      boxes,
      boxItems,
    })
    boxes = result.boxes
    boxItems = result.boxItems
  }

  await assignChinaOutboundBoxesToPalletsInTransaction({
    tx: input.tx,
    userId: input.userId,
    shipment: input.shipment,
    assignments: [...palletAssignmentsByBox.entries()]
      .filter(([, palletNo]) => palletNo != null)
      .map(([boxNo, palletNo]) => ({ boxNo, palletNo })),
    pallets: [],
    boxes,
  })
}

function chinaOutboundRegistrationSourceKey(warehouseCode: string, sku: string, optionKey: string) {
  return `${warehouseCode}\u0000${sku}\u0000${optionKey}`
}

/**
 * Adds more stock to an in-progress shipment. Existing box allocations stay
 * untouched; any added quantity remains unpacked until the operator splits it
 * into boxes in the next step.
 */
export async function addChinaOutboundShipmentItems(input: {
  userId: string
  createdBy: string
  shipmentId: string
  lines: ChinaOutboundShipmentLineInput[]
}) {
  await ensureSaasChinaOutboundSchema()
  const normalizedLines = normalizeShipmentLines(input.lines)
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const inventoryIds = normalizedLines.map((line) => line.inventoryId)
    const existingItems = await tx
      .select()
      .from(chinaOutboundShipmentItems)
      .where(and(
        eq(chinaOutboundShipmentItems.userId, input.userId),
        eq(chinaOutboundShipmentItems.shipmentId, shipment.id),
      ))
    const allInventoryIds = [...new Set([...inventoryIds, ...existingItems.map((item) => item.inventoryId)])]
    const inventories = await tx
      .select()
      .from(saasChinaInventory)
      .where(and(
        eq(saasChinaInventory.userId, input.userId),
        isNull(saasChinaInventory.archivedAt),
        inArray(saasChinaInventory.id, allInventoryIds),
      ))
    if (inventories.length !== allInventoryIds.length) {
      throw new Error('SaaS 중국재고에서 찾을 수 없는 출고 품목이 있습니다.')
    }

    const inventoriesById = new Map(inventories.map((inventory) => [inventory.id, inventory]))
    const existingItemsByInventoryId = new Map(existingItems.map((item) => [item.inventoryId, item]))
    const shipmentWarehouseCodes = new Set(existingItems
      .map((item) => item.originWarehouseCode || inventoriesById.get(item.inventoryId)?.warehouseCode)
      .filter((warehouseCode): warehouseCode is string => Boolean(warehouseCode)))
    for (const line of normalizedLines) {
      const inventory = inventoriesById.get(line.inventoryId)
      if (!inventory) throw new Error('SaaS 중국재고를 찾을 수 없습니다.')
      if (line.quantity > inventory.availableQuantity) {
        throw new Error(`${inventory.sku}의 추가 작업 가능 수량은 ${inventory.availableQuantity.toLocaleString('ko-KR')}개입니다.`)
      }
    }

    let nextSortOrder = existingItems.reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1
    const affectedPurchaseLinkIds = new Set<string>()
    for (const line of normalizedLines) {
      const inventory = inventoriesById.get(line.inventoryId)!
      const existingItem = existingItemsByInventoryId.get(inventory.id)
      shipmentWarehouseCodes.add(existingItem?.originWarehouseCode || inventory.warehouseCode)
      const [shipmentItem] = existingItem
        ? await tx
          .update(chinaOutboundShipmentItems)
          .set({
            reservedQuantity: existingItem.reservedQuantity + line.quantity,
            // The newly reserved quantity has not been placed into a box yet.
            // Do not leave a formerly completed split marked as completed.
            boxSplitStatus: 'in_progress',
            updatedAt: new Date(),
          })
          .where(and(
            eq(chinaOutboundShipmentItems.id, existingItem.id),
            eq(chinaOutboundShipmentItems.userId, input.userId),
            eq(chinaOutboundShipmentItems.shipmentId, shipment.id),
          ))
          .returning()
        : await tx
          .insert(chinaOutboundShipmentItems)
          .values({
            shipmentId: shipment.id,
            inventoryId: inventory.id,
            userId: input.userId,
            sku: inventory.sku,
            productName: inventory.productName,
            optionKey: inventory.optionKey,
            optionName: inventory.optionName,
            originWarehouseCode: inventory.warehouseCode,
            reservedQuantity: line.quantity,
            sortOrder: nextSortOrder++,
          })
          .returning()
      if (!shipmentItem) throw new Error('추가 출고 상품을 저장하지 못했습니다.')

      const allocatedPurchaseLinkIds = await reserveSaasChinaPurchaseLotsForShipmentItem(tx, {
        userId: input.userId,
        shipmentId: shipment.id,
        shipmentItemId: shipmentItem.id,
        inventoryId: inventory.id,
        quantity: line.quantity,
      })
      allocatedPurchaseLinkIds.forEach((id) => affectedPurchaseLinkIds.add(id))

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
        sourceKey: `china-outbound-reservation-add:${shipment.id}:${inventory.id}:${randomUUID()}`,
        note: shipment.shipmentNo,
        createdBy: input.createdBy,
      })
    }

    await tx
      .update(chinaOutboundShipments)
      .set({
        originWarehouseCode: getChinaOutboundOriginWarehouseCode(shipmentWarehouseCodes),
        updatedAt: new Date(),
      })
      .where(and(
        eq(chinaOutboundShipments.id, shipment.id),
        eq(chinaOutboundShipments.userId, input.userId),
      ))

    await reconcileSaasChinaPurchaseLinks(tx, input.userId, [...affectedPurchaseLinkIds])
    return shipment
  })
}

/**
 * Updates administrative shipment metadata only. The internal shipment number
 * intentionally remains immutable and display names are allowed to repeat.
 */
export async function updateChinaOutboundShipment(input: {
  userId: string
  shipmentId: string
  displayName?: string | null
  plannedOutboundDate?: string | null
}) {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getChinaOutboundShipment(tx, input.userId, input.shipmentId)
    // Omitted fields mean "leave unchanged"; null or an empty string means
    // "clear this value". This keeps the service safe for partial callers.
    const changes: Partial<typeof chinaOutboundShipments.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (input.displayName !== undefined) changes.displayName = optionalText(input.displayName)
    if (input.plannedOutboundDate !== undefined) changes.plannedOutboundDate = optionalText(input.plannedOutboundDate)
    const [updated] = await tx
      .update(chinaOutboundShipments)
      .set(changes)
      .where(and(
        eq(chinaOutboundShipments.id, shipment.id),
        eq(chinaOutboundShipments.userId, input.userId),
      ))
      .returning()
    if (!updated) throw new Error('출고작업 정보를 수정하지 못했습니다.')
    return updated
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

/**
 * Creates the requested pallet and box slots in one transaction. Existing
 * allocations are deliberately preserved: this operation can grow a setup,
 * but never removes a pallet or box that may already contain packed goods.
 */
export async function configureChinaOutboundPackaging(input: ConfigureChinaOutboundPackagingInput) {
  await ensureSaasChinaOutboundSchema()
  const palletCount = positiveInteger(input.palletCount, '파렛트 수')
  const boxCount = positiveInteger(input.boxCount, '박스 수')

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)

    const [existingPallets, existingBoxes] = await Promise.all([
      tx
        .select()
        .from(chinaOutboundPallets)
        .where(and(
          eq(chinaOutboundPallets.userId, input.userId),
          eq(chinaOutboundPallets.shipmentId, input.shipmentId),
        ))
        .orderBy(asc(chinaOutboundPallets.sortOrder), asc(chinaOutboundPallets.createdAt)),
      tx
        .select()
        .from(chinaOutboundBoxes)
        .where(and(
          eq(chinaOutboundBoxes.userId, input.userId),
          eq(chinaOutboundBoxes.shipmentId, input.shipmentId),
        ))
        .orderBy(asc(chinaOutboundBoxes.sortOrder), asc(chinaOutboundBoxes.createdAt)),
    ])

    if (palletCount < existingPallets.length || boxCount < existingBoxes.length) {
      throw new Error(`이미 파렛트 ${existingPallets.length}개·박스 ${existingBoxes.length}개가 생성되어 있습니다. 기존 수량보다 작게 줄일 수 없습니다.`)
    }

    const palletNos = new Set(existingPallets.map((pallet) => pallet.palletNo))
    const newPallets = [] as typeof existingPallets
    let nextPalletNumber = 1
    while (existingPallets.length + newPallets.length < palletCount) {
      const palletNo = nextGeneratedPackageNo('파렛트', palletNos, () => nextPalletNumber++)
      const [pallet] = await tx
        .insert(chinaOutboundPallets)
        .values({
          shipmentId: input.shipmentId,
          userId: input.userId,
          palletNo,
          sortOrder: existingPallets.length + newPallets.length,
        })
        .returning()
      if (!pallet) throw new Error('파렛트 구성을 저장하지 못했습니다.')
      newPallets.push(pallet)
    }

    const boxNos = new Set(existingBoxes.map((box) => box.boxNo))
    let nextBoxNumber = 1
    let createdBoxCount = 0
    while (existingBoxes.length + createdBoxCount < boxCount) {
      const boxNo = nextGeneratedPackageNo('박스', boxNos, () => nextBoxNumber++)
      const boxIndex = existingBoxes.length + createdBoxCount
      const [box] = await tx
        .insert(chinaOutboundBoxes)
        .values({
          shipmentId: input.shipmentId,
          userId: input.userId,
          // A box is intentionally left unassigned here. The operator decides
          // its pallet only while splitting an individual product in step 2.
          palletId: null,
          boxNo,
          sortOrder: boxIndex,
        })
        .returning()
      if (!box) throw new Error('박스 구성을 저장하지 못했습니다.')
      createdBoxCount += 1
    }

    return {
      palletCount,
      boxCount,
      addedPalletCount: newPallets.length,
      addedBoxCount: createdBoxCount,
    }
  })
}

/**
 * Stores the physical outer dimensions for one box. CBM remains derived from
 * these three measurements so it cannot become stale when a dimension changes.
 */
export async function saveChinaOutboundBoxDimensions(input: {
  userId: string
  shipmentId: string
  boxId: string
} & ChinaOutboundBoxDimensionsInput) {
  await ensureSaasChinaOutboundSchema()
  const dimensions = normalizeChinaOutboundBoxDimensions(input)

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const box = await getChinaOutboundBox(tx, input.userId, shipment.id, input.boxId)
    if (box.status !== 'open') throw new Error(`${box.boxNo}은(는) 봉인되어 규격을 수정할 수 없습니다.`)

    const [updated] = await tx
      .update(chinaOutboundBoxes)
      .set({
        lengthCm: dimensions.lengthCm == null ? null : String(dimensions.lengthCm),
        widthCm: dimensions.widthCm == null ? null : String(dimensions.widthCm),
        heightCm: dimensions.heightCm == null ? null : String(dimensions.heightCm),
        updatedAt: new Date(),
      })
      .where(eq(chinaOutboundBoxes.id, box.id))
      .returning()
    if (!updated) throw new Error('박스 규격을 저장하지 못했습니다.')
    const current = [box.lengthCm, box.widthCm, box.heightCm].map((value) => value == null ? null : Number(value))
    if (current[0] !== dimensions.lengthCm || current[1] !== dimensions.widthCm || current[2] !== dimensions.heightCm) {
      await markChinaOutboundBoxesChanged(tx, input.userId, shipment.id, [box.id])
    }
    return updated
  })
}

/** Save a batch atomically, without treating the separate seal state as progress. */
export async function saveChinaOutboundBoxCompletionStatuses(input: {
  userId: string
  shipmentId: string
  updates: Array<{ boxId: string; status: ChinaOutboundCompletionStatus }>
}) {
  validateCompletionUpdates(input.updates.map(({ boxId, status }) => ({ id: boxId, status })))
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const ids = input.updates.map((update) => update.boxId)
    const [boxes, items] = await Promise.all([
      tx.select().from(chinaOutboundBoxes).where(and(
        eq(chinaOutboundBoxes.userId, input.userId),
        eq(chinaOutboundBoxes.shipmentId, shipment.id),
        inArray(chinaOutboundBoxes.id, ids),
      )),
      tx.select({ boxId: chinaOutboundBoxItems.boxId }).from(chinaOutboundBoxItems).where(and(
        eq(chinaOutboundBoxItems.userId, input.userId),
        eq(chinaOutboundBoxItems.shipmentId, shipment.id),
        inArray(chinaOutboundBoxItems.boxId, ids),
      )),
    ])
    const boxesById = new Map(boxes.map((box) => [box.id, box]))
    const filledBoxIds = new Set(items.map((item) => item.boxId))
    for (const update of input.updates) {
      const box = boxesById.get(update.boxId)
      if (!box) throw new Error('해당 출고작업의 박스를 찾을 수 없습니다.')
      if (update.status === 'completed' && !filledBoxIds.has(box.id)) {
        throw new Error(`${box.boxNo}에 상품이 없어 완료로 표시할 수 없습니다.`)
      }
    }
    for (const status of CHINA_OUTBOUND_BOX_SPLIT_STATUSES) {
      const idsForStatus = input.updates.filter((update) => update.status === status).map((update) => update.boxId)
      if (idsForStatus.length === 0) continue
      await tx.update(chinaOutboundBoxes).set({ completionStatus: status, updatedAt: new Date() }).where(and(
        eq(chinaOutboundBoxes.userId, input.userId),
        eq(chinaOutboundBoxes.shipmentId, shipment.id),
        inArray(chinaOutboundBoxes.id, idsForStatus),
      ))
    }
    const inProgressBoxIds = new Set(input.updates.filter((update) => update.status === 'in_progress').map((update) => update.boxId))
    const palletIds = boxes
      .filter((box) => inProgressBoxIds.has(box.id))
      .flatMap((box) => box.palletId ? [box.palletId] : [])
    await markChinaOutboundPalletsChanged(tx, input.userId, shipment.id, palletIds)
  })
}

export async function saveChinaOutboundPalletCompletionStatuses(input: {
  userId: string
  shipmentId: string
  updates: Array<{ palletId: string; status: ChinaOutboundCompletionStatus }>
}) {
  validateCompletionUpdates(input.updates.map(({ palletId, status }) => ({ id: palletId, status })))
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const ids = input.updates.map((update) => update.palletId)
    const [pallets, boxes, items] = await Promise.all([
      tx.select().from(chinaOutboundPallets).where(and(
        eq(chinaOutboundPallets.userId, input.userId),
        eq(chinaOutboundPallets.shipmentId, shipment.id),
        inArray(chinaOutboundPallets.id, ids),
      )),
      tx.select().from(chinaOutboundBoxes).where(and(
        eq(chinaOutboundBoxes.userId, input.userId),
        eq(chinaOutboundBoxes.shipmentId, shipment.id),
        inArray(chinaOutboundBoxes.palletId, ids),
      )),
      tx.select({ boxId: chinaOutboundBoxItems.boxId }).from(chinaOutboundBoxItems).where(and(
        eq(chinaOutboundBoxItems.userId, input.userId),
        eq(chinaOutboundBoxItems.shipmentId, shipment.id),
      )),
    ])
    const palletsById = new Map(pallets.map((pallet) => [pallet.id, pallet]))
    const filledBoxIds = new Set(items.map((item) => item.boxId))
    const filledBoxesByPallet = new Map<string, ChinaOutboundBoxRow[]>()
    for (const box of boxes) {
      if (!box.palletId || !filledBoxIds.has(box.id)) continue
      const group = filledBoxesByPallet.get(box.palletId) ?? []
      group.push(box)
      filledBoxesByPallet.set(box.palletId, group)
    }
    for (const update of input.updates) {
      const pallet = palletsById.get(update.palletId)
      if (!pallet) throw new Error('해당 출고작업의 파렛트를 찾을 수 없습니다.')
      if (update.status !== 'completed') continue
      const filledBoxes = filledBoxesByPallet.get(pallet.id) ?? []
      if (filledBoxes.length === 0) throw new Error(`${pallet.palletNo}에 적재된 박스가 없어 완료로 표시할 수 없습니다.`)
      if (filledBoxes.some((box) => box.completionStatus === 'in_progress')) {
        throw new Error(`${pallet.palletNo}에 진행 중인 박스가 있습니다. 박스를 먼저 완료로 저장해주세요.`)
      }
    }
    for (const status of CHINA_OUTBOUND_BOX_SPLIT_STATUSES) {
      const idsForStatus = input.updates.filter((update) => update.status === status).map((update) => update.palletId)
      if (idsForStatus.length === 0) continue
      await tx.update(chinaOutboundPallets).set({ completionStatus: status, updatedAt: new Date() }).where(and(
        eq(chinaOutboundPallets.userId, input.userId),
        eq(chinaOutboundPallets.shipmentId, shipment.id),
        inArray(chinaOutboundPallets.id, idsForStatus),
      ))
    }
  })
}

function validateCompletionUpdates(updates: Array<{ id: string; status: ChinaOutboundCompletionStatus }>) {
  if (updates.length === 0 || updates.length > 5_000) throw new Error('저장할 상태를 선택해주세요.')
  const ids = new Set<string>()
  for (const update of updates) {
    if (!update.id || ids.has(update.id)) throw new Error('중복되거나 잘못된 항목이 있습니다.')
    if (update.status !== 'in_progress' && update.status !== 'completed') throw new Error('상태를 확인해주세요.')
    ids.add(update.id)
  }
}

/**
 * Replaces one item's box split without assigning a pallet. This is the
 * normal step-two write path; pallet assignment happens only in step three.
 */
export async function saveChinaOutboundItemBoxSplits(input: {
  userId: string
  shipmentId: string
  shipmentItemId: string
  allocations: ChinaOutboundBoxSplitInput[]
  boxSplitStatus?: ChinaOutboundBoxSplitStatus
}) {
  await ensureSaasChinaOutboundSchema()
  const allocations = normalizeChinaOutboundBoxSplitAllocations(input.allocations)

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const shipmentItem = await getChinaOutboundShipmentItem(tx, input.userId, shipment.id, input.shipmentItemId)
    const [boxes, boxItems] = await Promise.all([
      tx
        .select()
        .from(chinaOutboundBoxes)
        .where(and(
          eq(chinaOutboundBoxes.userId, input.userId),
          eq(chinaOutboundBoxes.shipmentId, shipment.id),
        ))
        .orderBy(asc(chinaOutboundBoxes.sortOrder), asc(chinaOutboundBoxes.createdAt)),
      tx
        .select()
        .from(chinaOutboundBoxItems)
        .where(and(
          eq(chinaOutboundBoxItems.userId, input.userId),
          eq(chinaOutboundBoxItems.shipmentId, shipment.id),
        )),
    ])

    await replaceChinaOutboundItemBoxSplitsInTransaction({
      tx,
      userId: input.userId,
      shipment,
      shipmentItem,
      allocations,
      boxSplitStatus: input.boxSplitStatus,
      boxes,
      boxItems,
    })
  })
}

/**
 * Assigns filled boxes to the pallet numbers the operator actually entered.
 * Empty pallet slots are never pre-created, so the displayed pallet count is
 * always the real number used for this shipment.
 */
export async function assignChinaOutboundBoxesToPallets(input: {
  userId: string
  shipmentId: string
  assignments: ChinaOutboundPalletAssignmentInput[]
}) {
  await ensureSaasChinaOutboundSchema()
  const assignments = normalizeChinaOutboundPalletAssignments(input.assignments)

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const [pallets, boxes] = await Promise.all([
      tx
        .select()
        .from(chinaOutboundPallets)
        .where(and(
          eq(chinaOutboundPallets.userId, input.userId),
          eq(chinaOutboundPallets.shipmentId, shipment.id),
        ))
        .orderBy(asc(chinaOutboundPallets.sortOrder), asc(chinaOutboundPallets.createdAt)),
      tx
        .select()
        .from(chinaOutboundBoxes)
        .where(and(
          eq(chinaOutboundBoxes.userId, input.userId),
          eq(chinaOutboundBoxes.shipmentId, shipment.id),
        )),
    ])

    await assignChinaOutboundBoxesToPalletsInTransaction({
      tx,
      userId: input.userId,
      shipment,
      assignments,
      pallets,
      boxes,
    })
  })
}

/** Applies the box and pallet sheets from one downloaded work workbook. */
export async function applyChinaOutboundWorkbook(input: {
  userId: string
  shipmentId: string
  boxSplits: ChinaOutboundWorkbookBoxSplitInput[]
  palletAssignments: ChinaOutboundPalletAssignmentInput[]
}) {
  await ensureSaasChinaOutboundSchema()
  const boxSplits = normalizeChinaOutboundWorkbookBoxSplits(input.boxSplits)
  const palletAssignments = normalizeChinaOutboundPalletAssignments(input.palletAssignments)

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const [shipmentItems, initialBoxes, initialBoxItems, initialPallets] = await Promise.all([
      tx
        .select()
        .from(chinaOutboundShipmentItems)
        .where(and(
          eq(chinaOutboundShipmentItems.userId, input.userId),
          eq(chinaOutboundShipmentItems.shipmentId, shipment.id),
        )),
      tx
        .select()
        .from(chinaOutboundBoxes)
        .where(and(
          eq(chinaOutboundBoxes.userId, input.userId),
          eq(chinaOutboundBoxes.shipmentId, shipment.id),
        ))
        .orderBy(asc(chinaOutboundBoxes.sortOrder), asc(chinaOutboundBoxes.createdAt)),
      tx
        .select()
        .from(chinaOutboundBoxItems)
        .where(and(
          eq(chinaOutboundBoxItems.userId, input.userId),
          eq(chinaOutboundBoxItems.shipmentId, shipment.id),
        )),
      tx
        .select()
        .from(chinaOutboundPallets)
        .where(and(
          eq(chinaOutboundPallets.userId, input.userId),
          eq(chinaOutboundPallets.shipmentId, shipment.id),
        ))
        .orderBy(asc(chinaOutboundPallets.sortOrder), asc(chinaOutboundPallets.createdAt)),
    ])
    const itemsById = new Map(shipmentItems.map((item) => [item.id, item]))
    let boxes = [...initialBoxes]
    let boxItems = [...initialBoxItems]

    for (const boxSplit of boxSplits) {
      const shipmentItem = itemsById.get(boxSplit.shipmentItemId)
      if (!shipmentItem) throw new Error('엑셀의 출고상품 ID가 현재 출고작업과 일치하지 않습니다.')
      const result = await replaceChinaOutboundItemBoxSplitsInTransaction({
        tx,
        userId: input.userId,
        shipment,
        shipmentItem,
        allocations: boxSplit.allocations,
        boxes,
        boxItems,
      })
      boxes = result.boxes
      boxItems = result.boxItems
    }

    await assignChinaOutboundBoxesToPalletsInTransaction({
      tx,
      userId: input.userId,
      shipment,
      assignments: palletAssignments,
      pallets: [...initialPallets],
      boxes,
    })

    return {
      updatedItemCount: boxSplits.length,
      updatedPalletAssignmentCount: palletAssignments.length,
    }
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
    await markChinaOutboundBoxesChanged(tx, input.userId, shipment.id, [box.id])

    const nextPackedQuantity = shipmentItem.packedQuantity + quantity
    await tx
      .update(chinaOutboundShipmentItems)
      .set({
        packedQuantity: nextPackedQuantity,
        boxSplitStatus: nextPackedQuantity === shipmentItem.reservedQuantity
          ? normalizeChinaOutboundBoxSplitStatus(shipmentItem.boxSplitStatus)
          : 'in_progress',
        updatedAt: new Date(),
      })
      .where(eq(chinaOutboundShipmentItems.id, shipmentItem.id))
    if (shipment.status === 'draft') {
      await tx
        .update(chinaOutboundShipments)
        .set({ status: 'packing', updatedAt: new Date() })
        .where(eq(chinaOutboundShipments.id, shipment.id))
    }
  })
}

/**
 * Replaces one product's box split in a single transaction. A box becomes
 * connected to a pallet only when the operator explicitly writes that
 * product's pallet and box numbers. This avoids inferring a packing layout
 * from the total box/pallet counts alone.
 */
export async function saveChinaOutboundItemPacking(input: {
  userId: string
  shipmentId: string
  shipmentItemId: string
  allocations: ChinaOutboundPackingAllocationInput[]
}) {
  await ensureSaasChinaOutboundSchema()
  const allocations = normalizeChinaOutboundPackingAllocations(input.allocations)

  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getEditableChinaOutboundShipment(tx, input.userId, input.shipmentId)
    const shipmentItem = await getChinaOutboundShipmentItem(tx, input.userId, shipment.id, input.shipmentItemId)
    const totalQuantity = allocations.reduce((total, allocation) => total + allocation.quantity, 0)
    if (totalQuantity > shipmentItem.reservedQuantity) {
      throw new Error(`${shipmentItem.sku}의 분할 수량은 출고수량 ${shipmentItem.reservedQuantity.toLocaleString('ko-KR')}개를 넘을 수 없습니다.`)
    }

    const [pallets, boxes, existingBoxItems] = await Promise.all([
      tx
        .select()
        .from(chinaOutboundPallets)
        .where(and(eq(chinaOutboundPallets.userId, input.userId), eq(chinaOutboundPallets.shipmentId, shipment.id)))
        .orderBy(asc(chinaOutboundPallets.sortOrder), asc(chinaOutboundPallets.createdAt)),
      tx
        .select()
        .from(chinaOutboundBoxes)
        .where(and(eq(chinaOutboundBoxes.userId, input.userId), eq(chinaOutboundBoxes.shipmentId, shipment.id)))
        .orderBy(asc(chinaOutboundBoxes.sortOrder), asc(chinaOutboundBoxes.createdAt)),
      tx
        .select({ id: chinaOutboundBoxItems.id, boxId: chinaOutboundBoxItems.boxId, shipmentItemId: chinaOutboundBoxItems.shipmentItemId, quantity: chinaOutboundBoxItems.quantity })
        .from(chinaOutboundBoxItems)
        .where(and(eq(chinaOutboundBoxItems.userId, input.userId), eq(chinaOutboundBoxItems.shipmentId, shipment.id))),
    ])

    const resolvedAllocations = allocations.map((allocation) => {
      const pallet = pallets[allocation.palletNumber - 1]
      if (!pallet) throw new Error(`파렛트 번호 ${allocation.palletNumber}번이 없습니다. 1~${pallets.length}번 안에서 입력해주세요.`)
      const box = boxes[allocation.boxNumber - 1]
      if (!box) throw new Error(`박스 번호 ${allocation.boxNumber}번이 없습니다. 1~${boxes.length}번 안에서 입력해주세요.`)
      if (box.status !== 'open') throw new Error(`${box.boxNo}은(는) 봉인되어 수정할 수 없습니다.`)
      return { ...allocation, pallet, box }
    })

    const occupiedByOtherItems = new Set(existingBoxItems.filter((item) => item.shipmentItemId !== shipmentItem.id).map((item) => item.boxId))
    for (const allocation of resolvedAllocations) {
      if (occupiedByOtherItems.has(allocation.box.id) && allocation.box.palletId && allocation.box.palletId !== allocation.pallet.id) {
        const currentPallet = pallets.find((pallet) => pallet.id === allocation.box.palletId)
        throw new Error(`${allocation.box.boxNo}에는 이미 다른 상품이 담겨 있습니다. ${currentPallet?.palletNo ?? '기존'} 파렛트 번호로 입력해주세요.`)
      }
    }

    const previousBoxIds = new Set(existingBoxItems.filter((item) => item.shipmentItemId === shipmentItem.id).map((item) => item.boxId))
    const previousByBox = new Map(existingBoxItems.filter((item) => item.shipmentItemId === shipmentItem.id).map((item) => [item.boxId, item.quantity]))
    const nextByBox = new Map(resolvedAllocations.map((allocation) => [allocation.box.id, allocation.quantity]))
    const affectedBoxIds = new Set<string>()
    const affectedPalletIds = new Set<string>()
    for (const box of boxes) {
      if (previousByBox.get(box.id) !== nextByBox.get(box.id)) affectedBoxIds.add(box.id)
      if (affectedBoxIds.has(box.id) && box.palletId) affectedPalletIds.add(box.palletId)
    }
    for (const allocation of resolvedAllocations) {
      if (allocation.box.palletId !== allocation.pallet.id) {
        if (allocation.box.palletId) affectedPalletIds.add(allocation.box.palletId)
        affectedPalletIds.add(allocation.pallet.id)
      }
      if (affectedBoxIds.has(allocation.box.id)) affectedPalletIds.add(allocation.pallet.id)
    }
    if (previousBoxIds.size > 0) {
      await tx
        .delete(chinaOutboundBoxItems)
        .where(and(
          eq(chinaOutboundBoxItems.userId, input.userId),
          eq(chinaOutboundBoxItems.shipmentId, shipment.id),
          eq(chinaOutboundBoxItems.shipmentItemId, shipmentItem.id),
        ))
    }

    const requestedBoxIds = new Set(resolvedAllocations.map((allocation) => allocation.box.id))
    for (const boxId of previousBoxIds) {
      if (requestedBoxIds.has(boxId) || occupiedByOtherItems.has(boxId)) continue
      await tx
        .update(chinaOutboundBoxes)
        .set({ palletId: null, updatedAt: new Date() })
        .where(eq(chinaOutboundBoxes.id, boxId))
    }

    for (const allocation of resolvedAllocations) {
      await tx
        .update(chinaOutboundBoxes)
        .set({ palletId: allocation.pallet.id, updatedAt: new Date() })
        .where(eq(chinaOutboundBoxes.id, allocation.box.id))
      await tx.insert(chinaOutboundBoxItems).values({
        boxId: allocation.box.id,
        shipmentId: shipment.id,
        shipmentItemId: shipmentItem.id,
        userId: input.userId,
        quantity: allocation.quantity,
      })
    }
    await markChinaOutboundBoxesChanged(tx, input.userId, shipment.id, [...affectedBoxIds])
    await markChinaOutboundPalletsChanged(tx, input.userId, shipment.id, [...affectedPalletIds])

    await tx
      .update(chinaOutboundShipmentItems)
      .set({
        packedQuantity: totalQuantity,
        boxSplitStatus: totalQuantity === shipmentItem.reservedQuantity
          ? normalizeChinaOutboundBoxSplitStatus(shipmentItem.boxSplitStatus)
          : 'in_progress',
        updatedAt: new Date(),
      })
      .where(eq(chinaOutboundShipmentItems.id, shipmentItem.id))
    if (shipment.status === 'draft' && totalQuantity > 0) {
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
    await markChinaOutboundBoxesChanged(tx, input.userId, shipment.id, [boxItem.boxId])
    await tx
      .update(chinaOutboundShipmentItems)
      .set({
        packedQuantity: shipmentItem.packedQuantity - boxItem.quantity,
        boxSplitStatus: 'in_progress',
        updatedAt: new Date(),
      })
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

    await dispatchSaasChinaPurchaseAllocationsForShipment(tx, input.userId, shipment.id)

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
    await releaseChinaOutboundShipmentReservations(tx, { ...input, shipment })
    const [updated] = await tx
      .update(chinaOutboundShipments)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(chinaOutboundShipments.id, shipment.id))
      .returning()
    if (!updated) throw new Error('출고작업 취소에 실패했습니다.')
    return updated
  })
}

/**
 * Permanently removes a non-dispatched outbound task after releasing every
 * inventory and purchase-lot reservation in the same transaction. Inventory
 * movements are retained as the audit trail; only the disposable work record
 * and its packing/allocation rows are removed.
 */
export async function deleteChinaOutboundShipment(input: { userId: string; createdBy: string; shipmentId: string }) {
  await ensureSaasChinaOutboundSchema()
  return db.transaction(async (tx) => {
    await lockSaasChinaOutboundWorkspace(tx, input.userId)
    const shipment = await getChinaOutboundShipment(tx, input.userId, input.shipmentId)
    if (!isChinaOutboundShipmentDeletable(shipment.status as ChinaOutboundShipmentStatus)) {
      throw new Error('출고완료 작업은 재고 차감 이력 때문에 삭제할 수 없습니다.')
    }

    // Cancelled work has already released reservations. A draft/packing/ready
    // work item must release first, before its child rows can be removed.
    if (shipment.status !== 'cancelled') {
      await releaseChinaOutboundShipmentReservations(tx, { ...input, shipment })
    }

    // Allocation rows deliberately use RESTRICT foreign keys so an accidental
    // shipment delete cannot silently bypass purchase-link reconciliation.
    await tx
      .delete(saasChinaShipmentPurchaseAllocations)
      .where(and(
        eq(saasChinaShipmentPurchaseAllocations.userId, input.userId),
        eq(saasChinaShipmentPurchaseAllocations.shipmentId, shipment.id),
      ))

    // Delete child rows explicitly, rather than relying on multiple cascades:
    // boxes restrict pallet deletion while they are still assigned to one.
    await tx
      .delete(chinaOutboundBoxItems)
      .where(and(
        eq(chinaOutboundBoxItems.userId, input.userId),
        eq(chinaOutboundBoxItems.shipmentId, shipment.id),
      ))
    await tx
      .delete(chinaOutboundBoxes)
      .where(and(
        eq(chinaOutboundBoxes.userId, input.userId),
        eq(chinaOutboundBoxes.shipmentId, shipment.id),
      ))
    await tx
      .delete(chinaOutboundPallets)
      .where(and(
        eq(chinaOutboundPallets.userId, input.userId),
        eq(chinaOutboundPallets.shipmentId, shipment.id),
      ))
    await tx
      .delete(chinaOutboundShipmentItems)
      .where(and(
        eq(chinaOutboundShipmentItems.userId, input.userId),
        eq(chinaOutboundShipmentItems.shipmentId, shipment.id),
      ))

    const [deleted] = await tx
      .delete(chinaOutboundShipments)
      .where(and(
        eq(chinaOutboundShipments.id, shipment.id),
        eq(chinaOutboundShipments.userId, input.userId),
      ))
      .returning({ id: chinaOutboundShipments.id })
    if (!deleted) throw new Error('출고작업을 삭제하지 못했습니다.')
    return deleted
  })
}

async function releaseChinaOutboundShipmentReservations(
  tx: DbTransaction,
  input: {
    userId: string
    createdBy: string
    shipment: typeof chinaOutboundShipments.$inferSelect
  },
) {
  const items = await tx
    .select()
    .from(chinaOutboundShipmentItems)
    .where(and(
      eq(chinaOutboundShipmentItems.userId, input.userId),
      eq(chinaOutboundShipmentItems.shipmentId, input.shipment.id),
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
      sourceKey: `china-outbound-release:${input.shipment.id}:${inventory.id}`,
      note: input.shipment.shipmentNo,
      createdBy: input.createdBy,
    })
  }
  await releaseSaasChinaPurchaseAllocationsForShipment(tx, input.userId, input.shipment.id)
}

async function reserveSaasChinaPurchaseLotsForShipmentItem(
  tx: DbTransaction,
  input: {
    userId: string
    shipmentId: string
    shipmentItemId: string
    inventoryId: string
    quantity: number
  },
) {
  const links = await tx
    .select()
    .from(saasChinaPurchaseLinks)
    .where(and(
      eq(saasChinaPurchaseLinks.userId, input.userId),
      eq(saasChinaPurchaseLinks.inventoryId, input.inventoryId),
    ))
    .orderBy(asc(saasChinaPurchaseLinks.createdAt), asc(saasChinaPurchaseLinks.id))

  const { allocations } = allocateSaasChinaPurchaseLots(links, input.quantity)
  const linksById = new Map(links.map((link) => [link.id, link]))
  const affectedLinkIds: string[] = []
  for (const allocation of allocations) {
    const link = linksById.get(allocation.purchaseLinkId)
    if (!link) throw new Error('발주 연동 SaaS 중국재고를 찾을 수 없습니다.')
    const [updatedLink] = await tx
      .update(saasChinaPurchaseLinks)
      .set({
        reservedQuantity: link.reservedQuantity + allocation.reservedQuantity,
        updatedAt: new Date(),
      })
      .where(eq(saasChinaPurchaseLinks.id, link.id))
      .returning()
    if (!updatedLink) throw new Error('발주 연동 출고예약을 저장하지 못했습니다.')

    const [existingAllocation] = await tx
      .select()
      .from(saasChinaShipmentPurchaseAllocations)
      .where(and(
        eq(saasChinaShipmentPurchaseAllocations.userId, input.userId),
        eq(saasChinaShipmentPurchaseAllocations.shipmentItemId, input.shipmentItemId),
        eq(saasChinaShipmentPurchaseAllocations.purchaseLinkId, link.id),
      ))
      .limit(1)
    if (existingAllocation) {
      await tx
        .update(saasChinaShipmentPurchaseAllocations)
        .set({
          reservedQuantity: existingAllocation.reservedQuantity + allocation.reservedQuantity,
          updatedAt: new Date(),
        })
        .where(eq(saasChinaShipmentPurchaseAllocations.id, existingAllocation.id))
    } else {
      await tx.insert(saasChinaShipmentPurchaseAllocations).values({
        userId: input.userId,
        shipmentId: input.shipmentId,
        shipmentItemId: input.shipmentItemId,
        purchaseLinkId: link.id,
        reservedQuantity: allocation.reservedQuantity,
      })
    }
    affectedLinkIds.push(link.id)
  }

  // Any remaining quantity comes from a manually received/opening SaaS stock
  // balance, which intentionally has no purchase-request link.
  return affectedLinkIds
}

async function dispatchSaasChinaPurchaseAllocationsForShipment(
  tx: DbTransaction,
  userId: string,
  shipmentId: string,
) {
  const allocations = await tx
    .select()
    .from(saasChinaShipmentPurchaseAllocations)
    .where(and(
      eq(saasChinaShipmentPurchaseAllocations.userId, userId),
      eq(saasChinaShipmentPurchaseAllocations.shipmentId, shipmentId),
    ))
  if (allocations.length === 0) return

  const shipmentItemIds = allocations.map((allocation) => allocation.shipmentItemId)
  const shipmentItems = await tx
    .select({ id: chinaOutboundShipmentItems.id, inventoryId: chinaOutboundShipmentItems.inventoryId })
    .from(chinaOutboundShipmentItems)
    .where(and(
      eq(chinaOutboundShipmentItems.userId, userId),
      eq(chinaOutboundShipmentItems.shipmentId, shipmentId),
      inArray(chinaOutboundShipmentItems.id, shipmentItemIds),
    ))
  const shipmentItemById = new Map(shipmentItems.map((item) => [item.id, item]))
  const affectedLinkIds = new Set<string>()

  for (const allocation of allocations) {
    const unresolvedQuantity = allocation.reservedQuantity
      - allocation.dispatchedQuantity
      - allocation.releasedQuantity
    if (unresolvedQuantity <= 0) continue
    const shipmentItem = shipmentItemById.get(allocation.shipmentItemId)
    if (!shipmentItem) throw new Error('발주 연동 출고 상품을 찾을 수 없습니다.')
    const link = await getSaasChinaPurchaseLinkById(tx, userId, allocation.purchaseLinkId)
    if (link.inventoryId !== shipmentItem.inventoryId) {
      throw new Error('발주 연동 재고와 출고 상품이 일치하지 않습니다.')
    }
    if (link.reservedQuantity < unresolvedQuantity) {
      throw new Error('발주 연동 출고예약 수량이 맞지 않습니다.')
    }

    await tx
      .update(saasChinaShipmentPurchaseAllocations)
      .set({
        dispatchedQuantity: allocation.dispatchedQuantity + unresolvedQuantity,
        updatedAt: new Date(),
      })
      .where(eq(saasChinaShipmentPurchaseAllocations.id, allocation.id))
    await tx
      .update(saasChinaPurchaseLinks)
      .set({
        reservedQuantity: link.reservedQuantity - unresolvedQuantity,
        dispatchedQuantity: link.dispatchedQuantity + unresolvedQuantity,
        updatedAt: new Date(),
      })
      .where(eq(saasChinaPurchaseLinks.id, link.id))
    affectedLinkIds.add(link.id)
  }

  await reconcileSaasChinaPurchaseLinks(tx, userId, [...affectedLinkIds])
}

async function releaseSaasChinaPurchaseAllocationsForShipment(
  tx: DbTransaction,
  userId: string,
  shipmentId: string,
) {
  const allocations = await tx
    .select()
    .from(saasChinaShipmentPurchaseAllocations)
    .where(and(
      eq(saasChinaShipmentPurchaseAllocations.userId, userId),
      eq(saasChinaShipmentPurchaseAllocations.shipmentId, shipmentId),
    ))
  if (allocations.length === 0) return

  const shipmentItemIds = allocations.map((allocation) => allocation.shipmentItemId)
  const shipmentItems = await tx
    .select({ id: chinaOutboundShipmentItems.id, inventoryId: chinaOutboundShipmentItems.inventoryId })
    .from(chinaOutboundShipmentItems)
    .where(and(
      eq(chinaOutboundShipmentItems.userId, userId),
      eq(chinaOutboundShipmentItems.shipmentId, shipmentId),
      inArray(chinaOutboundShipmentItems.id, shipmentItemIds),
    ))
  const shipmentItemById = new Map(shipmentItems.map((item) => [item.id, item]))
  const affectedLinkIds = new Set<string>()

  for (const allocation of allocations) {
    const unresolvedQuantity = allocation.reservedQuantity
      - allocation.dispatchedQuantity
      - allocation.releasedQuantity
    if (unresolvedQuantity <= 0) continue
    const shipmentItem = shipmentItemById.get(allocation.shipmentItemId)
    if (!shipmentItem) throw new Error('발주 연동 출고 상품을 찾을 수 없습니다.')
    const link = await getSaasChinaPurchaseLinkById(tx, userId, allocation.purchaseLinkId)
    if (link.inventoryId !== shipmentItem.inventoryId) {
      throw new Error('발주 연동 재고와 출고 상품이 일치하지 않습니다.')
    }
    if (link.reservedQuantity < unresolvedQuantity) {
      throw new Error('발주 연동 출고예약 수량이 맞지 않아 취소할 수 없습니다.')
    }

    await tx
      .update(saasChinaShipmentPurchaseAllocations)
      .set({
        releasedQuantity: allocation.releasedQuantity + unresolvedQuantity,
        updatedAt: new Date(),
      })
      .where(eq(saasChinaShipmentPurchaseAllocations.id, allocation.id))
    await tx
      .update(saasChinaPurchaseLinks)
      .set({
        reservedQuantity: link.reservedQuantity - unresolvedQuantity,
        updatedAt: new Date(),
      })
      .where(eq(saasChinaPurchaseLinks.id, link.id))
    affectedLinkIds.add(link.id)
  }

  await reconcileSaasChinaPurchaseLinks(tx, userId, [...affectedLinkIds])
}

async function reconcileSaasChinaPurchaseLinks(
  tx: DbTransaction,
  userId: string,
  linkIds: string[],
) {
  const uniqueLinkIds = [...new Set(linkIds)]
  if (uniqueLinkIds.length === 0) return

  const links = await tx
    .select()
    .from(saasChinaPurchaseLinks)
    .where(and(
      eq(saasChinaPurchaseLinks.userId, userId),
      inArray(saasChinaPurchaseLinks.id, uniqueLinkIds),
    ))
  const purchaseItemIds = links.map((link) => link.purchaseRequestItemId)
  if (purchaseItemIds.length === 0) return
  const purchaseItems = await tx
    .select()
    .from(purchaseRequestItems)
    .where(and(
      eq(purchaseRequestItems.userId, userId),
      inArray(purchaseRequestItems.id, purchaseItemIds),
    ))
  const purchaseItemById = new Map(purchaseItems.map((item) => [item.id, item]))

  for (const link of links) {
    const item = purchaseItemById.get(link.purchaseRequestItemId)
    if (!item) throw new Error('발주 연동 항목을 찾을 수 없습니다.')
    const outboundQuantity = link.reservedQuantity + link.dispatchedQuantity
    const nextStatus = getSaasChinaPurchaseLifecycleStatus(link)
    await tx
      .update(purchaseRequestItems)
      .set({
        status: nextStatus,
        chinaReceivedQuantity: link.receivedQuantity,
        rawData: {
          ...item.rawData,
          saasChinaMode: true,
          saasChinaReceivedQuantity: link.receivedQuantity,
          saasChinaReservedQuantity: link.reservedQuantity,
          saasChinaDispatchedQuantity: link.dispatchedQuantity,
          outboundRequestedQuantity: outboundQuantity,
        },
        updatedAt: new Date(),
      })
      .where(and(
        eq(purchaseRequestItems.userId, userId),
        eq(purchaseRequestItems.id, item.id),
      ))
  }
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
  const statusUnfinished = items.find((item) => item.boxSplitStatus === 'in_progress')
  if (statusUnfinished) {
    throw new Error(`${statusUnfinished.sku}의 박스분할 상태가 진행 중입니다. 박스분할을 확인한 뒤 완료로 저장해주세요.`)
  }
  const [boxes, packedBoxItems, pallets] = await Promise.all([
    tx
      .select({ id: chinaOutboundBoxes.id, boxNo: chinaOutboundBoxes.boxNo, palletId: chinaOutboundBoxes.palletId, completionStatus: chinaOutboundBoxes.completionStatus })
      .from(chinaOutboundBoxes)
      .where(and(eq(chinaOutboundBoxes.userId, userId), eq(chinaOutboundBoxes.shipmentId, shipmentId))),
    tx
      .select({ boxId: chinaOutboundBoxItems.boxId })
      .from(chinaOutboundBoxItems)
      .where(and(eq(chinaOutboundBoxItems.userId, userId), eq(chinaOutboundBoxItems.shipmentId, shipmentId))),
    tx
      .select({ id: chinaOutboundPallets.id, palletNo: chinaOutboundPallets.palletNo, completionStatus: chinaOutboundPallets.completionStatus })
      .from(chinaOutboundPallets)
      .where(and(eq(chinaOutboundPallets.userId, userId), eq(chinaOutboundPallets.shipmentId, shipmentId))),
  ])
  if (boxes.length === 0) throw new Error('박스를 하나 이상 등록해주세요.')
  const packedBoxIds = new Set(packedBoxItems.map((boxItem) => boxItem.boxId))
  if (boxes.some((box) => packedBoxIds.has(box.id) && !box.palletId)) throw new Error('상품이 담긴 박스는 파렛트 번호를 지정해주세요.')
  const unfinishedBox = boxes.find((box) => packedBoxIds.has(box.id) && box.completionStatus === 'in_progress')
  if (unfinishedBox) throw new Error(`${unfinishedBox.boxNo} 박스 상태가 진행 중입니다. 완료로 저장해주세요.`)
  const usedPalletIds = new Set(boxes.flatMap((box) => packedBoxIds.has(box.id) && box.palletId ? [box.palletId] : []))
  const unfinishedPallet = pallets.find((pallet) => usedPalletIds.has(pallet.id) && pallet.completionStatus === 'in_progress')
  if (unfinishedPallet) throw new Error(`${unfinishedPallet.palletNo} 파렛트 상태가 진행 중입니다. 완료로 저장해주세요.`)
}

async function markChinaOutboundPalletsChanged(tx: DbTransaction, userId: string, shipmentId: string, palletIds: string[]) {
  const ids = [...new Set(palletIds)]
  if (ids.length === 0) return
  await tx.update(chinaOutboundPallets).set({ completionStatus: 'in_progress', updatedAt: new Date() }).where(and(
    eq(chinaOutboundPallets.userId, userId),
    eq(chinaOutboundPallets.shipmentId, shipmentId),
    inArray(chinaOutboundPallets.id, ids),
  ))
}

async function markChinaOutboundBoxesChanged(tx: DbTransaction, userId: string, shipmentId: string, boxIds: string[]) {
  const ids = [...new Set(boxIds)]
  if (ids.length === 0) return
  const updated = await tx.update(chinaOutboundBoxes).set({ completionStatus: 'in_progress', updatedAt: new Date() }).where(and(
    eq(chinaOutboundBoxes.userId, userId),
    eq(chinaOutboundBoxes.shipmentId, shipmentId),
    inArray(chinaOutboundBoxes.id, ids),
  )).returning({ palletId: chinaOutboundBoxes.palletId })
  await markChinaOutboundPalletsChanged(tx, userId, shipmentId, updated.flatMap((box) => box.palletId ? [box.palletId] : []))
}

type NormalizedSaasChinaInventoryWorkbookRow = Omit<SaasChinaInventoryExcelRow, 'warehouseCode' | 'sku' | 'productName' | 'optionName' | 'itemCategory' | 'optionKey' | 'note' | 'errors'> & {
  warehouseCode: string
  sku: string
  productName: string | null
  optionName: string | null
  itemCategory: string | null
  optionKey: string
  note: string | null
  errors: string[]
}

type SaasChinaInventoryWorkbookPlanInput = {
  userId: string
  rows: readonly SaasChinaInventoryExcelRow[]
  inventories: ReadonlyArray<typeof saasChinaInventory.$inferSelect>
  linkedOnHandByInventoryId: ReadonlyMap<string, number>
  /** A recognized inventory-status report is an authoritative list, unlike the editable template. */
  fullSnapshot?: boolean
  /** An explicit warehouse scope. Omit it when the report replaces every active warehouse. */
  snapshotWarehouseCodes?: readonly string[]
}

/**
 * Pure planner shared by preview and transactional apply. Keeping the decision
 * here makes a later apply recompute every protection against fresh data while
 * allowing focused tests without a database connection.
 */
export function buildSaasChinaInventoryWorkbookPreview(
  input: SaasChinaInventoryWorkbookPlanInput,
): SaasChinaInventoryWorkbookPreview {
  // The query callers already scope this list to the shared workspace, but
  // filtering again here makes an inventory ID from another workspace
  // unconditionally invalid even if a future caller passes a broader list.
  const workspaceInventories = input.inventories.filter((inventory) => inventory.userId === input.userId)
  const activeInventories = workspaceInventories.filter((inventory) => inventory.archivedAt == null)
  // Prefer the live generation when historical rows share the same identity.
  const inventoriesByIdentity = new Map([
    ...workspaceInventories.filter((inventory) => inventory.archivedAt != null),
    ...activeInventories,
  ].map((inventory) => [
    saasChinaInventoryIdentityKey(inventory.warehouseCode, inventory.sku, inventory.optionKey),
    inventory,
  ]))
  const inventoriesById = new Map(workspaceInventories.map((inventory) => [inventory.id, inventory]))
  const rows = input.rows.map(normalizeSaasChinaInventoryWorkbookRow)
  // A specified scope limits a replacement to those warehouses. Production
  // uploads omit this option and therefore replace every active warehouse.
  const snapshotWarehouseCodeList = input.fullSnapshot
    ? (input.snapshotWarehouseCodes ?? [])
      .map((warehouseCode) => warehouseCode.trim())
      .filter(Boolean)
    : []
  const snapshotWarehouseCodes = snapshotWarehouseCodeList.length > 0
    ? new Set(snapshotWarehouseCodeList)
    : null
  const duplicateRowNumbers = duplicateSaasChinaInventoryWorkbookRowNumbers(rows)
  const previewRows: SaasChinaInventoryWorkbookPreviewRow[] = []

  for (const row of rows) {
    const identity = saasChinaInventoryIdentityKey(row.warehouseCode, row.sku, row.optionKey)
    const isReplacementRow = input.fullSnapshot
      && (snapshotWarehouseCodes == null || snapshotWarehouseCodes.has(row.warehouseCode))
    const rowErrors = [...row.errors, ...validateSaasChinaInventoryWorkbookRow(row)]
    if (duplicateRowNumbers.has(row.rowNumber)) {
      rowErrors.push('같은 중국창고·품목코드·옵션명 조합이 엑셀에 중복되어 있습니다.')
    }
    if (input.fullSnapshot && !isReplacementRow) {
      rowErrors.push('전체 교체 범위에 없는 중국창고입니다.')
    }
    if (rowErrors.length > 0) {
      previewRows.push({
        row: row.rowNumber,
        warehouseCode: row.warehouseCode,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        beforeQuantity: null,
        afterQuantity: row.onHandQuantity,
        status: 'invalid',
        message: rowErrors[0],
      })
      continue
    }

    if (isReplacementRow) {
      if (!row.productName) {
        previewRows.push({
          row: row.rowNumber,
          warehouseCode: row.warehouseCode,
          sku: row.sku,
          productName: null,
          optionName: row.optionName,
          beforeQuantity: null,
          afterQuantity: row.onHandQuantity,
          status: 'invalid',
          message: '새 재고는 상품명을 입력해주세요.',
        })
        continue
      }
      if (row.onHandQuantity == null || row.onHandQuantity <= 0) {
        previewRows.push({
          row: row.rowNumber,
          warehouseCode: row.warehouseCode,
          sku: row.sku,
          productName: row.productName,
          optionName: row.optionName,
          beforeQuantity: null,
          afterQuantity: row.onHandQuantity,
          status: 'invalid',
          message: '새 재고는 현재고를 1개 이상 입력해주세요.',
        })
        continue
      }
      previewRows.push({
        row: row.rowNumber,
        warehouseCode: row.warehouseCode,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        itemCategory: row.itemCategory,
        beforeQuantity: null,
        afterQuantity: row.onHandQuantity,
        status: 'new',
        message: '새 엑셀 기준으로 재고를 새로 생성합니다.',
      })
      continue
    }

    const inventoryById = row.inventoryId ? inventoriesById.get(row.inventoryId) : null
    if (row.inventoryId && !inventoryById) {
      previewRows.push({
        row: row.rowNumber,
        warehouseCode: row.warehouseCode,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        beforeQuantity: null,
        afterQuantity: row.onHandQuantity,
        status: 'invalid',
        message: '엑셀의 SaaS재고ID를 현재 목록에서 찾을 수 없습니다.',
      })
      continue
    }
    if (inventoryById && saasChinaInventoryIdentityKey(
      inventoryById.warehouseCode,
      inventoryById.sku,
      inventoryById.optionKey,
    ) !== identity) {
      previewRows.push({
        row: row.rowNumber,
        warehouseCode: row.warehouseCode,
        sku: row.sku,
        productName: row.productName ?? inventoryById.productName,
        optionName: row.optionName,
        beforeQuantity: inventoryById.onHandQuantity,
        afterQuantity: row.onHandQuantity,
        status: 'invalid',
        message: '현재 목록에서 내려받은 중국창고·품목코드·옵션명은 변경할 수 없습니다.',
      })
      continue
    }
    const existing = inventoryById ?? inventoriesByIdentity.get(identity)
    if (!existing) {
      // Blank warehouse-quantity cells in a partial template are a no-op. A
      // full replacement has already rejected zero-quantity rows above.
      if (row.reportBlankQuantity && row.onHandQuantity === 0) {
        previewRows.push({
          row: row.rowNumber,
          warehouseCode: row.warehouseCode,
          sku: row.sku,
          productName: row.productName,
          optionName: row.optionName,
          beforeQuantity: null,
          afterQuantity: 0,
          status: 'unchanged',
          message: '재고현황의 빈 중국창고 수량입니다. 현재 SaaS 재고가 없어 신규 등록하지 않습니다.',
        })
        continue
      }
      if (!row.productName) {
        previewRows.push({
          row: row.rowNumber,
          warehouseCode: row.warehouseCode,
          sku: row.sku,
          productName: null,
          optionName: row.optionName,
          beforeQuantity: null,
          afterQuantity: row.onHandQuantity,
          status: 'invalid',
          message: '새 재고는 상품명을 입력해주세요.',
        })
        continue
      }
      if (row.onHandQuantity == null || row.onHandQuantity < 0 || row.onHandQuantity === 0) {
        previewRows.push({
          row: row.rowNumber,
          warehouseCode: row.warehouseCode,
          sku: row.sku,
          productName: row.productName,
          optionName: row.optionName,
          beforeQuantity: null,
          afterQuantity: row.onHandQuantity,
          status: 'invalid',
          message: '새 재고는 현재고를 1개 이상 입력해주세요.',
        })
        continue
      }
      previewRows.push({
        row: row.rowNumber,
        warehouseCode: row.warehouseCode,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        beforeQuantity: null,
        afterQuantity: row.onHandQuantity,
        status: 'new',
      })
      continue
    }

    const afterQuantity = row.onHandQuantity ?? existing.onHandQuantity
    const linkedOnHand = input.linkedOnHandByInventoryId.get(existing.id) ?? 0
    const requiredMinimum = Math.max(existing.reservedQuantity, linkedOnHand)
    if (afterQuantity < requiredMinimum) {
      const protection = afterQuantity < existing.reservedQuantity
        ? `출고 예약 ${existing.reservedQuantity.toLocaleString('ko-KR')}개보다 적게 줄일 수 없습니다.`
        : `발주 연동 재고 ${linkedOnHand.toLocaleString('ko-KR')}개보다 적게 줄일 수 없습니다.`
      previewRows.push({
        row: row.rowNumber,
        warehouseCode: row.warehouseCode,
        sku: row.sku,
        productName: row.productName ?? existing.productName,
        optionName: row.optionName,
        beforeQuantity: existing.onHandQuantity,
        afterQuantity,
        status: 'protected',
        message: protection,
      })
      continue
    }

    const productName = row.productName ?? existing.productName
    const itemCategory = row.itemCategory ?? existing.itemCategory
    const restoresArchivedInventory = existing.archivedAt != null
    const reportBlankQuantityMessage = row.reportBlankQuantity && afterQuantity === 0
      ? afterQuantity === existing.onHandQuantity
        ? '재고현황의 빈 중국창고 수량이 0으로 확인되었습니다.'
        : '재고현황의 빈 중국창고 수량을 0으로 변경합니다.'
      : undefined
    previewRows.push({
      row: row.rowNumber,
      warehouseCode: row.warehouseCode,
      sku: row.sku,
      productName,
      optionName: row.optionName,
      itemCategory,
      beforeQuantity: existing.onHandQuantity,
      afterQuantity,
      status: afterQuantity === existing.onHandQuantity
        && productName === existing.productName
        && itemCategory === existing.itemCategory
        && !restoresArchivedInventory
        ? 'unchanged'
        : 'changed',
      ...(restoresArchivedInventory
        ? { message: '재고현황 파일에 포함되어 목록에 다시 표시합니다.' }
        : reportBlankQuantityMessage ? { message: reportBlankQuantityMessage } : {}),
    })
  }

  if (input.fullSnapshot) {
    for (const existing of activeInventories) {
      if (snapshotWarehouseCodes != null && !snapshotWarehouseCodes.has(existing.warehouseCode)) continue
      const linkedOnHand = input.linkedOnHandByInventoryId.get(existing.id) ?? 0
      const requiredMinimum = Math.max(existing.reservedQuantity, linkedOnHand)
      if (requiredMinimum > 0) {
        const protection = existing.reservedQuantity > 0
          ? `전체 교체를 할 수 없습니다. 출고 예약 ${existing.reservedQuantity.toLocaleString('ko-KR')}개를 먼저 처리해주세요.`
          : `전체 교체를 할 수 없습니다. 발주 연동 재고 ${linkedOnHand.toLocaleString('ko-KR')}개를 먼저 처리해주세요.`
        previewRows.push({
          row: null,
          inventoryId: existing.id,
          warehouseCode: existing.warehouseCode,
          sku: existing.sku,
          productName: existing.productName,
          optionName: existing.optionName,
          beforeQuantity: existing.onHandQuantity,
          afterQuantity: 0,
          status: 'protected',
          message: protection,
        })
        continue
      }

      previewRows.push({
        row: null,
        inventoryId: existing.id,
        warehouseCode: existing.warehouseCode,
        sku: existing.sku,
        productName: existing.productName,
        optionName: existing.optionName,
        beforeQuantity: existing.onHandQuantity,
        afterQuantity: 0,
        status: 'removed',
        message: '새 엑셀 반영을 위해 기존 활성 재고를 삭제합니다.',
      })
    }
  }

  const newCount = previewRows.filter((row) => row.status === 'new').length
  const changedCount = previewRows.filter((row) => row.status === 'changed').length
  const unchangedCount = previewRows.filter((row) => row.status === 'unchanged').length
  const removedCount = previewRows.filter((row) => row.status === 'removed').length
  const invalidRows = previewRows.filter((row) => row.status === 'invalid' || row.status === 'protected')
  const errors = invalidRows.map((row) => row.row == null
    ? `${[row.sku, row.optionName].filter(Boolean).join(' · ') || '엑셀에 없는 재고'}: ${row.message ?? '입력값을 확인해주세요.'}`
    : `${row.row}행: ${row.message ?? '입력값을 확인해주세요.'}`)
  return {
    summary: {
      newCount,
      changedCount,
      unchangedCount,
      removedCount,
      invalidCount: invalidRows.length,
      rowCount: previewRows.length,
    },
    rows: previewRows,
    ...(errors.length > 0 ? { errors } : {}),
  }
}

function normalizeSaasChinaInventoryWorkbookRow(
  row: SaasChinaInventoryExcelRow,
): NormalizedSaasChinaInventoryWorkbookRow {
  const warehouseCode = String(row.warehouseCode ?? '').trim()
  const sku = String(row.sku ?? '').trim()
  const inventoryId = optionalText(row.inventoryId)
  const productName = optionalText(row.productName)
  const optionName = optionalText(row.optionName)
  const itemCategory = optionalText(row.itemCategory)
  const note = optionalText(row.note)
  return {
    ...row,
    inventoryId,
    warehouseCode,
    sku,
    productName,
    optionName,
    itemCategory,
    optionKey: optionName ?? '',
    note,
    errors: [...(row.errors ?? [])],
  }
}

function validateSaasChinaInventoryWorkbookRow(row: NormalizedSaasChinaInventoryWorkbookRow) {
  const errors: string[] = []
  if (!row.warehouseCode) errors.push('중국창고를 입력해주세요.')
  if (
    isSaasChinaInventoryExcludedWarehouseCode(row.warehouseCode)
    && !row.errors.includes(SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_ERROR)
  ) {
    errors.push(SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_ERROR)
  }
  if (!row.sku) errors.push('품목코드를 입력해주세요.')
  if (row.inventoryId && !isUuid(row.inventoryId)) errors.push('SaaS재고ID를 확인해주세요.')
  if (row.warehouseCode.length > 100) errors.push('중국창고는 100자 이하로 입력해주세요.')
  if (row.sku.length > 100) errors.push('품목코드는 100자 이하로 입력해주세요.')
  if (row.productName && row.productName.length > 1_000) errors.push('상품명은 1,000자 이하로 입력해주세요.')
  if (row.optionName && row.optionName.length > 200) errors.push('옵션명은 200자 이하로 입력해주세요.')
  if (row.itemCategory && row.itemCategory.length > 100) errors.push('품목구분은 100자 이하로 입력해주세요.')
  if (row.note && row.note.length > 2_000) errors.push('메모는 2,000자 이하로 입력해주세요.')
  if (row.onHandQuantity != null && (!Number.isSafeInteger(row.onHandQuantity) || row.onHandQuantity < 0)) {
    errors.push('현재고는 0 이상의 정수로 입력해주세요.')
  }
  return errors
}

function assertSaasChinaInventoryWarehouseAllowed(warehouseCode: string) {
  if (isSaasChinaInventoryExcludedWarehouseCode(warehouseCode)) {
    throw new Error(SAAS_CHINA_INVENTORY_EXCLUDED_WAREHOUSE_ERROR)
  }
}

function requiredWarehouseCode(value: string | null | undefined, label: string) {
  const warehouseCode = requiredText(value, label)
  if (warehouseCode.length > 100) throw new Error(`${label}은(는) 100자 이하로 입력해주세요.`)
  assertSaasChinaInventoryWarehouseAllowed(warehouseCode)
  return warehouseCode
}

function duplicateSaasChinaInventoryWorkbookRowNumbers(rows: readonly NormalizedSaasChinaInventoryWorkbookRow[]) {
  const rowsByIdentity = new Map<string, number[]>()
  for (const row of rows) {
    if (!row.warehouseCode || !row.sku) continue
    const key = saasChinaInventoryIdentityKey(row.warehouseCode, row.sku, row.optionKey)
    const current = rowsByIdentity.get(key) ?? []
    current.push(row.rowNumber)
    rowsByIdentity.set(key, current)
  }
  return new Set([...rowsByIdentity.values()].filter((rowNumbers) => rowNumbers.length > 1).flat())
}

function saasChinaInventoryIdentityKey(warehouseCode: string, sku: string, optionKey: string) {
  return `${warehouseCode}\u0000${sku}\u0000${optionKey}`
}

function saasChinaInventoryWorkbookPlanKey(
  rowNumber: number,
  warehouseCode: string,
  sku: string,
  optionName: string | null,
) {
  return `${rowNumber}\u0000${saasChinaInventoryIdentityKey(warehouseCode, sku, optionName ?? '')}`
}

function excelInventoryNote(sourceLabel: string | null | undefined) {
  const label = optionalText(sourceLabel)
  return label ? `엑셀 재고 목록 반영: ${label}` : '엑셀 재고 목록 반영'
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

async function getSaasChinaInventoryForUpdate(tx: DbTransaction, userId: string, inventoryId: string) {
  const [inventory] = await tx
    .select()
    .from(saasChinaInventory)
    .where(and(
      eq(saasChinaInventory.userId, userId),
      eq(saasChinaInventory.id, inventoryId),
      isNull(saasChinaInventory.archivedAt),
    ))
    .limit(1)
  if (!inventory) throw new Error('SaaS 중국재고를 찾을 수 없습니다.')
  return inventory
}

async function getSaasChinaPurchaseLinkForUpdate(
  tx: DbTransaction,
  userId: string,
  purchaseRequestItemId: string,
): Promise<SaasChinaPurchaseLinkRow> {
  const [link] = await tx
    .select()
    .from(saasChinaPurchaseLinks)
    .where(and(
      eq(saasChinaPurchaseLinks.userId, userId),
      eq(saasChinaPurchaseLinks.purchaseRequestItemId, purchaseRequestItemId),
    ))
    .limit(1)
  if (!link) throw new Error('SaaS 중국재고와 연결된 발주 입고를 찾을 수 없습니다.')
  return link
}

async function getSaasChinaPurchaseLinkById(
  tx: DbTransaction,
  userId: string,
  linkId: string,
): Promise<SaasChinaPurchaseLinkRow> {
  const [link] = await tx
    .select()
    .from(saasChinaPurchaseLinks)
    .where(and(
      eq(saasChinaPurchaseLinks.userId, userId),
      eq(saasChinaPurchaseLinks.id, linkId),
    ))
    .limit(1)
  if (!link) throw new Error('발주 연동 SaaS 중국재고를 찾을 수 없습니다.')
  return link
}

async function getSaasChinaPurchaseLinkedOnHand(
  tx: DbTransaction,
  userId: string,
  inventoryId: string,
) {
  const [{ quantity }] = await tx
    .select({
      quantity: sql<number>`COALESCE(SUM(${saasChinaPurchaseLinks.receivedQuantity} - ${saasChinaPurchaseLinks.dispatchedQuantity}), 0)::int`,
    })
    .from(saasChinaPurchaseLinks)
    .where(and(
      eq(saasChinaPurchaseLinks.userId, userId),
      eq(saasChinaPurchaseLinks.inventoryId, inventoryId),
    ))
  return quantity ?? 0
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

async function ensureSaasChinaOutboundWarehouseCatalog(
  tx: DbTransaction,
  input: { userId: string; createdBy?: string },
) {
  const [configuredWarehouses, activeInventoryRows] = await Promise.all([
    tx
      .select()
      .from(saasChinaOutboundWarehouses)
      .where(eq(saasChinaOutboundWarehouses.userId, input.userId)),
    tx
      .select({ warehouseCode: saasChinaInventory.warehouseCode })
      .from(saasChinaInventory)
      .where(and(
        eq(saasChinaInventory.userId, input.userId),
        isNull(saasChinaInventory.archivedAt),
      )),
  ])

  const activeWarehouseCodes = new Set(
    activeInventoryRows
      .map((inventory) => inventory.warehouseCode.trim())
      .filter((warehouseCode) => Boolean(warehouseCode) && !isSaasChinaInventoryExcludedWarehouseCode(warehouseCode)),
  )
  const configuredByCode = new Map(
    configuredWarehouses.map((warehouse) => [warehouse.warehouseCode, warehouse]),
  )
  let defaultWarehouse = configuredWarehouses.find((warehouse) => warehouse.isDefault) ?? null

  if (!defaultWarehouse) {
    const legacyDefault = configuredByCode.get(SAAS_CHINA_DEFAULT_WAREHOUSE_CODE)
    if (legacyDefault) {
      const [updated] = await tx
        .update(saasChinaOutboundWarehouses)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(saasChinaOutboundWarehouses.id, legacyDefault.id))
        .returning()
      defaultWarehouse = updated ?? null
      if (defaultWarehouse) configuredByCode.set(defaultWarehouse.warehouseCode, defaultWarehouse)
    } else {
      const [created] = await tx
        .insert(saasChinaOutboundWarehouses)
        .values({
          userId: input.userId,
          warehouseCode: SAAS_CHINA_DEFAULT_WAREHOUSE_CODE,
          isDefault: true,
          createdBy: input.createdBy ?? null,
        })
        .returning()
      if (!created) throw new Error('기본 출고창고를 준비하지 못했습니다.')
      defaultWarehouse = created
      configuredByCode.set(created.warehouseCode, created)
    }
  }

  const missingWarehouseCodes = [...activeWarehouseCodes]
    .filter((warehouseCode) => !configuredByCode.has(warehouseCode))
  if (missingWarehouseCodes.length > 0) {
    const inserted = await tx
      .insert(saasChinaOutboundWarehouses)
      .values(missingWarehouseCodes.map((warehouseCode) => ({
        userId: input.userId,
        warehouseCode,
        isDefault: false,
        createdBy: input.createdBy ?? null,
      })))
      .returning()
    inserted.forEach((warehouse) => configuredByCode.set(warehouse.warehouseCode, warehouse))
  }

  const warehouses = [...configuredByCode.values()]
    .map((warehouse) => ({
      warehouseCode: warehouse.warehouseCode,
      isDefault: warehouse.isDefault,
      hasActiveInventory: activeWarehouseCodes.has(warehouse.warehouseCode),
    }))
    .sort((left, right) => left.warehouseCode.localeCompare(right.warehouseCode, 'ko-KR', { numeric: true }))
  const resolvedDefault = warehouses.find((warehouse) => warehouse.isDefault)
  if (!resolvedDefault) throw new Error('기본 출고창고를 찾을 수 없습니다.')

  return {
    warehouses,
    activeWarehouseCodes,
    defaultWarehouseCode: resolvedDefault.warehouseCode,
  }
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

function normalizeChinaOutboundPackingAllocations(allocations: ChinaOutboundPackingAllocationInput[]) {
  const quantitiesByBoxNumber = new Map<number, { palletNumber: number; quantity: number }>()
  for (const allocation of allocations) {
    const palletNumber = positiveInteger(allocation.palletNumber, '파렛트 번호')
    const boxNumber = positiveInteger(allocation.boxNumber, '박스 번호')
    const quantity = positiveInteger(allocation.quantity, '박스 적재 수량')
    const current = quantitiesByBoxNumber.get(boxNumber)
    if (current && current.palletNumber !== palletNumber) {
      throw new Error(`박스 ${boxNumber}번은 한 파렛트에만 배정할 수 있습니다.`)
    }
    quantitiesByBoxNumber.set(boxNumber, {
      palletNumber,
      quantity: (current?.quantity ?? 0) + quantity,
    })
  }
  return [...quantitiesByBoxNumber.entries()].map(([boxNumber, allocation]) => ({ boxNumber, ...allocation }))
}

function normalizeChinaOutboundWorkbookBoxSplits(boxSplits: ChinaOutboundWorkbookBoxSplitInput[]) {
  const allocationsByShipmentItemId = new Map<string, ChinaOutboundBoxSplitInput[]>()
  for (const boxSplit of boxSplits) {
    const shipmentItemId = requiredText(boxSplit.shipmentItemId, '출고상품 ID')
    if (allocationsByShipmentItemId.has(shipmentItemId)) {
      throw new Error('같은 출고상품 ID가 엑셀에 여러 번 있습니다.')
    }
    allocationsByShipmentItemId.set(shipmentItemId, normalizeChinaOutboundBoxSplitAllocations(boxSplit.allocations))
  }
  return [...allocationsByShipmentItemId.entries()].map(([shipmentItemId, allocations]) => ({ shipmentItemId, allocations }))
}

function normalizeChinaOutboundBoxSplitAllocations(allocations: ChinaOutboundBoxSplitInput[]) {
  const allocationsByBoxNo = new Map<string, ChinaOutboundBoxSplitInput>()
  for (const allocation of allocations) {
    const boxNo = requiredText(allocation.boxNo, '박스 번호')
    const quantity = positiveInteger(allocation.quantity, '박스 적재 수량')
    const dimensions = normalizeOptionalChinaOutboundBoxDimensions(allocation)
    const current = allocationsByBoxNo.get(boxNo)
    if (current) {
      const currentDimensions = normalizeOptionalChinaOutboundBoxDimensions(current)
      if (dimensions && currentDimensions && !sameChinaOutboundBoxDimensions(dimensions, currentDimensions)) {
        throw new Error(`${boxNo}의 가로·세로·높이가 서로 다릅니다.`)
      }
      allocationsByBoxNo.set(boxNo, {
        boxNo,
        quantity: current.quantity + quantity,
        ...(currentDimensions ?? dimensions ?? {}),
      })
      continue
    }
    allocationsByBoxNo.set(boxNo, { boxNo, quantity, ...(dimensions ?? {}) })
  }
  return [...allocationsByBoxNo.values()]
}

function normalizeChinaOutboundPalletAssignments(assignments: ChinaOutboundPalletAssignmentInput[]) {
  const palletByBoxNo = new Map<string, string | null>()
  for (const assignment of assignments) {
    const boxNo = requiredText(assignment.boxNo, '박스 번호')
    const palletNo = optionalText(assignment.palletNo)
    const current = palletByBoxNo.get(boxNo)
    if (current !== undefined && current !== palletNo) {
      throw new Error(`${boxNo}에 서로 다른 파렛트 번호가 입력되었습니다.`)
    }
    palletByBoxNo.set(boxNo, palletNo)
  }
  return [...palletByBoxNo.entries()].map(([boxNo, palletNo]) => ({ boxNo, palletNo }))
}

function normalizeChinaOutboundBoxSplitStatus(value: string | null | undefined): ChinaOutboundBoxSplitStatus | null {
  return value === 'in_progress' || value === 'completed' ? value : null
}

function normalizeOptionalChinaOutboundBoxDimensions(input: {
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
}) {
  const hasValue = [input.lengthCm, input.widthCm, input.heightCm].some((value) => value != null)
  if (!hasValue) return null
  return normalizeChinaOutboundBoxDimensions({
    lengthCm: input.lengthCm ?? null,
    widthCm: input.widthCm ?? null,
    heightCm: input.heightCm ?? null,
  })
}

function sameChinaOutboundBoxDimensions(
  left: ChinaOutboundBoxDimensionsInput,
  right: ChinaOutboundBoxDimensionsInput,
) {
  return left.lengthCm === right.lengthCm
    && left.widthCm === right.widthCm
    && left.heightCm === right.heightCm
}

async function replaceChinaOutboundItemBoxSplitsInTransaction(input: {
  tx: DbTransaction
  userId: string
  shipment: ChinaOutboundShipmentRow
  shipmentItem: ChinaOutboundShipmentItemRow
  allocations: ChinaOutboundBoxSplitInput[]
  boxSplitStatus?: ChinaOutboundBoxSplitStatus
  boxes: ChinaOutboundBoxRow[]
  boxItems: ChinaOutboundBoxItemRow[]
}) {
  const totalQuantity = input.allocations.reduce((total, allocation) => total + allocation.quantity, 0)
  if (totalQuantity > input.shipmentItem.reservedQuantity) {
    throw new Error(`${input.shipmentItem.sku}의 분할 수량은 출고수량 ${input.shipmentItem.reservedQuantity.toLocaleString('ko-KR')}개를 넘을 수 없습니다.`)
  }
  if (input.boxSplitStatus === 'completed' && totalQuantity !== input.shipmentItem.reservedQuantity) {
    throw new Error(`${input.shipmentItem.sku}은(는) 포장수량이 출고수량과 같아야 완료로 표시할 수 있습니다.`)
  }
  const nextBoxSplitStatus = totalQuantity !== input.shipmentItem.reservedQuantity
    ? 'in_progress'
    : input.boxSplitStatus ?? normalizeChinaOutboundBoxSplitStatus(input.shipmentItem.boxSplitStatus)

  const boxesByNo = new Map(input.boxes.map((box) => [box.boxNo, box]))
  for (const allocation of input.allocations) {
    const box = boxesByNo.get(allocation.boxNo)
    if (box?.status === 'sealed') throw new Error(`${box.boxNo}은(는) 봉인되어 수정할 수 없습니다.`)
  }

  const previousBoxItems = input.boxItems.filter((boxItem) => boxItem.shipmentItemId === input.shipmentItem.id)
  const previousQuantitiesByBox = new Map(previousBoxItems.map((boxItem) => [boxItem.boxId, boxItem.quantity]))
  const allocationsByBoxNo = new Map(input.allocations.map((allocation) => [allocation.boxNo, allocation]))
  const boxesById = new Map(input.boxes.map((box) => [box.id, box]))
  const changedBoxIds = new Set<string>()
  for (const previous of previousBoxItems) {
    const box = boxesById.get(previous.boxId)
    if (!box || allocationsByBoxNo.get(box.boxNo)?.quantity !== previous.quantity) changedBoxIds.add(previous.boxId)
  }
  if (previousBoxItems.length > 0) {
    await input.tx
      .delete(chinaOutboundBoxItems)
      .where(and(
        eq(chinaOutboundBoxItems.userId, input.userId),
        eq(chinaOutboundBoxItems.shipmentId, input.shipment.id),
        eq(chinaOutboundBoxItems.shipmentItemId, input.shipmentItem.id),
      ))
  }
  let nextBoxItems = input.boxItems.filter((boxItem) => boxItem.shipmentItemId !== input.shipmentItem.id)

  for (const allocation of input.allocations) {
    let box = boxesByNo.get(allocation.boxNo)
    const dimensions = normalizeOptionalChinaOutboundBoxDimensions(allocation)
    if (!box) {
      const [created] = await input.tx
        .insert(chinaOutboundBoxes)
        .values({
          shipmentId: input.shipment.id,
          userId: input.userId,
          palletId: null,
          boxNo: allocation.boxNo,
          sortOrder: input.boxes.length,
          lengthCm: dimensions?.lengthCm == null ? null : String(dimensions.lengthCm),
          widthCm: dimensions?.widthCm == null ? null : String(dimensions.widthCm),
          heightCm: dimensions?.heightCm == null ? null : String(dimensions.heightCm),
        })
        .returning()
      if (!created) throw new Error('박스를 저장하지 못했습니다.')
      box = created
      input.boxes.push(created)
      boxesByNo.set(created.boxNo, created)
      changedBoxIds.add(created.id)
    } else if (dimensions) {
      if (Number(box.lengthCm) !== dimensions.lengthCm || Number(box.widthCm) !== dimensions.widthCm || Number(box.heightCm) !== dimensions.heightCm) {
        changedBoxIds.add(box.id)
      }
      const [updated] = await input.tx
        .update(chinaOutboundBoxes)
        .set({
          lengthCm: String(dimensions.lengthCm),
          widthCm: String(dimensions.widthCm),
          heightCm: String(dimensions.heightCm),
          updatedAt: new Date(),
        })
        .where(eq(chinaOutboundBoxes.id, box.id))
        .returning()
      if (!updated) throw new Error('박스 규격을 저장하지 못했습니다.')
      const index = input.boxes.findIndex((candidate) => candidate.id === updated.id)
      if (index >= 0) input.boxes[index] = updated
      box = updated
      boxesByNo.set(updated.boxNo, updated)
    }

    if (previousQuantitiesByBox.get(box.id) !== allocation.quantity) changedBoxIds.add(box.id)

    const [boxItem] = await input.tx
      .insert(chinaOutboundBoxItems)
      .values({
        boxId: box.id,
        shipmentId: input.shipment.id,
        shipmentItemId: input.shipmentItem.id,
        userId: input.userId,
        quantity: allocation.quantity,
      })
      .returning()
    if (!boxItem) throw new Error('박스 분할 수량을 저장하지 못했습니다.')
    nextBoxItems = [...nextBoxItems, boxItem]
  }

  await markChinaOutboundBoxesChanged(input.tx, input.userId, input.shipment.id, [...changedBoxIds])

  await input.tx
    .update(chinaOutboundShipmentItems)
    .set({ packedQuantity: totalQuantity, boxSplitStatus: nextBoxSplitStatus, updatedAt: new Date() })
    .where(eq(chinaOutboundShipmentItems.id, input.shipmentItem.id))

  if (input.shipment.status === 'draft' && totalQuantity > 0) {
    await input.tx
      .update(chinaOutboundShipments)
      .set({ status: 'packing', updatedAt: new Date() })
      .where(eq(chinaOutboundShipments.id, input.shipment.id))
  }

  return { boxes: input.boxes, boxItems: nextBoxItems }
}

async function assignChinaOutboundBoxesToPalletsInTransaction(input: {
  tx: DbTransaction
  userId: string
  shipment: ChinaOutboundShipmentRow
  assignments: ChinaOutboundPalletAssignmentInput[]
  pallets: ChinaOutboundPalletRow[]
  boxes: ChinaOutboundBoxRow[]
}) {
  const boxesByNo = new Map(input.boxes.map((box) => [box.boxNo, box]))
  const palletsByNo = new Map(input.pallets.map((pallet) => [pallet.palletNo, pallet]))
  const changedPalletIds = new Set<string>()

  for (const assignment of input.assignments) {
    const box = boxesByNo.get(assignment.boxNo)
    if (!box) throw new Error(`${assignment.boxNo}을(를) 현재 출고작업에서 찾을 수 없습니다.`)
    if (box.status === 'sealed') throw new Error(`${box.boxNo}은(는) 봉인되어 파렛트를 변경할 수 없습니다.`)

    let pallet: ChinaOutboundPalletRow | null = null
    if (assignment.palletNo) {
      pallet = palletsByNo.get(assignment.palletNo) ?? null
      if (!pallet) {
        const [created] = await input.tx
          .insert(chinaOutboundPallets)
          .values({
            shipmentId: input.shipment.id,
            userId: input.userId,
            palletNo: assignment.palletNo,
            sortOrder: input.pallets.length,
          })
          .returning()
        if (!created) throw new Error('파렛트를 저장하지 못했습니다.')
        pallet = created
        input.pallets.push(created)
        palletsByNo.set(created.palletNo, created)
      }
    }

    if (box.palletId !== (pallet?.id ?? null)) {
      if (box.palletId) changedPalletIds.add(box.palletId)
      if (pallet) changedPalletIds.add(pallet.id)
    }
    const [updated] = await input.tx
      .update(chinaOutboundBoxes)
      .set({ palletId: pallet?.id ?? null, updatedAt: new Date() })
      .where(eq(chinaOutboundBoxes.id, box.id))
      .returning()
    if (!updated) throw new Error('박스의 파렛트 배정을 저장하지 못했습니다.')
    const index = input.boxes.findIndex((candidate) => candidate.id === updated.id)
    if (index >= 0) input.boxes[index] = updated
    boxesByNo.set(updated.boxNo, updated)
  }
  await markChinaOutboundPalletsChanged(input.tx, input.userId, input.shipment.id, [...changedPalletIds])
}

function normalizeChinaOutboundBoxDimensions(input: ChinaOutboundBoxDimensionsInput) {
  const lengthCm = positiveDecimal(input.lengthCm, '가로')
  const widthCm = positiveDecimal(input.widthCm, '세로')
  const heightCm = positiveDecimal(input.heightCm, '높이')
  const filledCount = [lengthCm, widthCm, heightCm].filter((value) => value != null).length
  if (filledCount > 0 && filledCount < 3) {
    throw new Error('가로·세로·높이는 모두 입력하거나 모두 비워주세요.')
  }
  return { lengthCm, widthCm, heightCm }
}

function requiredText(value: string | null | undefined, label: string) {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${label}을(를) 입력해주세요.`)
  return normalized
}

function nextGeneratedPackageNo(prefix: string, used: Set<string>, nextNumber: () => number) {
  let number = nextNumber()
  while (used.has(`${prefix} ${number}`)) number = nextNumber()
  const packageNo = `${prefix} ${number}`
  used.add(packageNo)
  return packageNo
}

function optionalText(value: string | null | undefined) {
  const normalized = value?.trim()
  return normalized || null
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label}은(는) 1 이상의 정수여야 합니다.`)
  return value
}

function positiveDecimal(value: number | null | undefined, label: string) {
  if (value == null) return null
  if (!Number.isFinite(value) || value <= 0 || value > 9_999_999.99) {
    throw new Error(`${label}은(는) 0보다 큰 숫자로 입력해주세요.`)
  }
  const rounded = Math.round(value * 100) / 100
  if (Math.abs(value - rounded) > 0.000_000_1) {
    throw new Error(`${label}은(는) 소수점 둘째 자리까지 입력해주세요.`)
  }
  return rounded
}

function nonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label}은(는) 0 이상의 정수여야 합니다.`)
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
