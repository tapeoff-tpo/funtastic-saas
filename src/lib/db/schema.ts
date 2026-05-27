import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  varchar,
  jsonb,
  boolean,
  integer,
  numeric,
  uniqueIndex,
  index,
  date,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ─── Phase 1: Marketplace Connections ───────────────────────────

export const connectionStatusEnum = pgEnum('connection_status', [
  'connected',
  'error',
  'expired',
  'disconnected',
])

export const authTypeEnum = pgEnum('auth_type', [
  'hmac',
  'oauth2',
  'api_key',
  'session',
])

export const marketplaceConnections = pgTable('marketplace_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
  storeAlias: varchar('store_alias', { length: 100 }).notNull().default('default'),
  displayName: text('display_name').notNull(),
  authType: authTypeEnum('auth_type').notNull(),
  status: connectionStatusEnum('status').notNull().default('disconnected'),
  vaultSecretNames: jsonb('vault_secret_names').$type<string[]>().notNull(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastErrorMessage: text('last_error_message'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  isManual: boolean('is_manual').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  uniqueIndex('marketplace_connections_user_market_alias').on(
    table.userId, table.marketplaceId, table.storeAlias
  ),
])

export const commonAuthProfiles = pgTable('common_auth_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull().default('naver_email'),
  accountEmail: varchar('account_email', { length: 255 }).notNull(),
  vaultSecretNames: jsonb('vault_secret_names').$type<string[]>().notNull().default([]),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  uniqueIndex('common_auth_profiles_user_provider_name').on(
    table.userId, table.provider, table.name,
  ),
  index('common_auth_profiles_user_provider').on(table.userId, table.provider),
])

// ─── Phase 2: Order Management ──────────────────────────────────

export const orderStatusEnum = pgEnum('order_status', [
  'new',
  'confirmed',
  'preparing',
  'ready',
  'shipped',
  'delivering',
  'delivered',
  'cancelled',
])

export const claimTypeEnum = pgEnum('claim_type', [
  'cancel',
  'return',
  'exchange',
])

export const claimStatusEnum = pgEnum('claim_status', [
  'requested',
  'processing',
  'completed',
  'rejected',
  'withdrawn',
])

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** 사용자에게 보이는 8자리 내부 주문번호 — 화면/엑셀에 노출. UUID 와 별개. */
    internalNo: varchar('internal_no', { length: 8 }).notNull(),
    userId: uuid('user_id').notNull(),
    connectionId: uuid('connection_id')
      .references(() => marketplaceConnections.id),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceOrderId: varchar('marketplace_order_id', { length: 200 }).notNull(),
    status: orderStatusEnum('status').notNull().default('new'),
    previousStatus: orderStatusEnum('previous_status'),
    buyerName: varchar('buyer_name', { length: 200 }).notNull(),
    /** 구매자 전화번호1 — 일반전화/집전화 */
    buyerPhone: varchar('buyer_phone', { length: 50 }),
    /** 구매자 전화번호2 — 휴대폰 (기본 표기용, 우선순위 위) */
    buyerPhone2: varchar('buyer_phone2', { length: 50 }),
    recipientName: varchar('recipient_name', { length: 200 }).notNull(),
    /** 수령인 전화번호1 — 일반전화/집전화 */
    recipientPhone: varchar('recipient_phone', { length: 50 }),
    /** 수령인 전화번호2 — 휴대폰 (기본 표기용, 우선순위 위) */
    recipientPhone2: varchar('recipient_phone2', { length: 50 }),
    shippingAddress: jsonb('shipping_address').$type<{
      zipCode: string
      address1: string
      address2?: string
    }>(),
    orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull(),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    isHeld: boolean('is_held').notNull().default(false),
    holdReason: text('hold_reason'),
    heldAt: timestamp('held_at', { withTimezone: true }),
    /** 물류메세지 — 출고 담당자 참고용 (예: "경동택배 미발건", "출고 전 취소요청") */
    logisticsMessage: varchar('logistics_message', { length: 200 }),
    /** 배송메세지 — 구매자가 마켓에서 입력한 배송 요청사항 (쿠팡 parcelPrintMessage 등). migration 019. */
    deliveryMessage: varchar('delivery_message', { length: 500 }),
    rawData: jsonb('raw_data').$type<Record<string, unknown>>(),
    marketplaceStatus: varchar('marketplace_status', { length: 100 }),
    marketplaceCollectionStatus: varchar('marketplace_collection_status', { length: 50 }),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    /** 배송구분 (prepaid/cod/free/unknown) — 마켓에서 수집 (Phase 8 / migration 011) */
    shippingType: varchar('shipping_type', { length: 50 }),
    /** 마켓에서 수집된 배송비 (KRW). NULL = 미수집/미존재. (Phase 8 / migration 011) */
    shippingFee: numeric('shipping_fee', { precision: 12, scale: 2 }),
    /** 복사된 주문 표시 — true 이면 unique 제약에서 제외됨 (migration 016) */
    isCopy: boolean('is_copy').notNull().default(false),
    /** 매핑 적용 시점 (apply-mappings API 실행 시각) — migration 020 */
    mappedAt: timestamp('mapped_at', { withTimezone: true }),
    /** 매핑을 적용한 사용자 ID — migration 020 */
    mappedByUserId: uuid('mapped_by_user_id'),
    /** 출고준비(preparing) 전환 시점 — migration 020 */
    preparingAt: timestamp('preparing_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('orders_marketplace_unique')
      .on(table.marketplaceId, table.marketplaceOrderId)
      .where(sql`${table.isCopy} = false`),
    index('orders_user_status').on(table.userId, table.status),
    index('orders_user_status_ordered_at').on(table.userId, table.status, table.orderedAt),
    index('orders_user_marketplace_ordered_at').on(table.userId, table.marketplaceId, table.orderedAt),
    index('orders_user_collected_at').on(table.userId, table.collectedAt),
    index('orders_ordered_at').on(table.orderedAt),
    uniqueIndex('orders_user_internal_no_unique').on(table.userId, table.internalNo),
  ],
)

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    marketplaceItemId: varchar('marketplace_item_id', { length: 200 }),
    productName: text('product_name').notNull(),
    optionText: text('option_text'),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    sku: varchar('sku', { length: 100 }),
    /** 매핑에서 가져온 멀티플라이어. 예: "A 2개입" 마켓 상품 매핑 시 2 */
    skuMultiplier: integer('sku_multiplier').notNull().default(1),
    fulfillmentCode: varchar('fulfillment_code', { length: 50 }).default('normal'),
    lockedSku: varchar('locked_sku', { length: 100 }),
    lockedProductName: text('locked_product_name'),
    lockedOptionName: text('locked_option_name'),
    lockedQuantity: integer('locked_quantity'),
    lockedMappingCodeId: uuid('locked_mapping_code_id'),
    lockedMappingCode: varchar('locked_mapping_code', { length: 100 }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedByUserId: uuid('locked_by_user_id'),
  },
  (table) => [
    index('order_items_order_id').on(table.orderId),
    index('order_items_sku').on(table.sku),
    index('order_items_marketplace_item_id').on(table.marketplaceItemId),
  ],
)

export const orderMemos = pgTable(
  'order_memos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    content: text('content').notNull(),
    memoType: varchar('memo_type', { length: 50 }).notNull().default('general'),
    attachments: jsonb('attachments').$type<Array<{
      name: string
      type: string
      dataUrl: string
      size: number
    }>>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('order_memos_order_id_created').on(table.orderId, table.createdAt),
  ],
)

export const orderChangeLogs = pgTable(
  'order_change_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 80 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('order_change_logs_order_created').on(table.orderId, table.createdAt),
    index('order_change_logs_user_created').on(table.userId, table.createdAt),
    index('order_change_logs_action_created').on(table.action, table.createdAt),
  ],
)

export const giftRules = pgTable(
  'gift_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    marketplaceId: varchar('marketplace_id', { length: 50 }),
    conditionType: varchar('condition_type', { length: 20 }).notNull(),
    minAmount: numeric('min_amount', { precision: 12, scale: 2 }),
    triggerSku: varchar('trigger_sku', { length: 100 }),
    conditions: jsonb('conditions').$type<Array<{ type: string; value: string }>>().notNull().default([]),
    giftSku: varchar('gift_sku', { length: 100 }).notNull(),
    giftQuantity: integer('gift_quantity').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('gift_rules_user_active').on(table.userId, table.isActive),
    index('gift_rules_user_marketplace').on(table.userId, table.marketplaceId),
  ],
)

export const claims = pgTable(
  'claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    userId: uuid('user_id').notNull(),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceClaimId: varchar('marketplace_claim_id', { length: 200 }).notNull(),
    claimType: claimTypeEnum('claim_type').notNull(),
    claimStatus: claimStatusEnum('claim_status').notNull().default('requested'),
    reason: text('reason'),
    rawData: jsonb('raw_data').$type<Record<string, unknown>>(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('claims_marketplace_unique').on(
      table.marketplaceId,
      table.marketplaceClaimId,
    ),
    index('claims_order_id').on(table.orderId),
  ],
)

// ─── Phase 3: Shipping & Invoice Processing ────────────────────

export const uploadStatusEnum = pgEnum('upload_status', [
  'pending',
  'uploading',
  'uploaded',
  'failed',
  'confirmed',
])

export const shipmentGroupStatusEnum = pgEnum('shipment_group_status', [
  'suggested',
  'confirmed',
  'rejected',
  'shipped',
])

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    userId: uuid('user_id').notNull(),
    trackingNumber: varchar('tracking_number', { length: 100 }).notNull(),
    carrierId: varchar('carrier_id', { length: 50 }).notNull(),
    carrierName: varchar('carrier_name', { length: 100 }).notNull(),
    uploadStatus: uploadStatusEnum('upload_status').notNull().default('pending'),
    marketplaceUploadError: text('marketplace_upload_error'),
    uploadAttempts: integer('upload_attempts').notNull().default(0),
    lastUploadAt: timestamp('last_upload_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('shipments_order_id').on(table.orderId),
    index('shipments_upload_status').on(table.uploadStatus),
    index('shipments_user_tracking_number_idx').on(table.userId, table.trackingNumber),
  ],
)

export const shipmentItems = pgTable('shipment_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  shipmentId: uuid('shipment_id')
    .notNull()
    .references(() => shipments.id, { onDelete: 'cascade' }),
  orderItemId: uuid('order_item_id')
    .notNull()
    .references(() => orderItems.id),
  quantity: integer('quantity').notNull().default(1),
})

export const actualShippingCosts = pgTable(
  'actual_shipping_costs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    carrierId: varchar('carrier_id', { length: 50 }).notNull(),
    trackingNumber: varchar('tracking_number', { length: 100 }).notNull(),
    normalizedTrackingNumber: varchar('normalized_tracking_number', { length: 100 }).notNull(),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    orderNumber: varchar('order_number', { length: 200 }),
    acceptedAt: date('accepted_at'),
    deliveredAt: date('delivered_at'),
    actualFee: numeric('actual_fee', { precision: 12, scale: 2 }).notNull(),
    packageType: varchar('package_type', { length: 100 }),
    quantity: integer('quantity').notNull().default(1),
    paymentType: varchar('payment_type', { length: 100 }),
    shipmentType: varchar('shipment_type', { length: 100 }),
    sourceFileName: varchar('source_file_name', { length: 255 }),
    rowNumber: integer('row_number').notNull(),
    rawData: jsonb('raw_data').$type<Record<string, unknown>>().notNull().default({}),
    importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('actual_shipping_costs_user_carrier_tracking_unique').on(
      table.userId,
      table.carrierId,
      table.normalizedTrackingNumber,
    ),
    index('actual_shipping_costs_user_imported_idx').on(table.userId, table.importedAt),
    index('actual_shipping_costs_shipment_idx').on(table.shipmentId),
  ],
)

export const shipmentGroups = pgTable('shipment_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  groupKey: varchar('group_key', { length: 200 }).notNull(),
  status: shipmentGroupStatusEnum('status').notNull().default('suggested'),
  fulfillmentCode: varchar('fulfillment_code', { length: 50 }).notNull().default('normal'),
  maxPackQuantity: integer('max_pack_quantity').notNull().default(10),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const shipmentGroupOrders = pgTable('shipment_group_orders', {
  shipmentGroupId: uuid('shipment_group_id')
    .notNull()
    .references(() => shipmentGroups.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
}, (table) => [
  // Composite primary key via unique index
  uniqueIndex('shipment_group_orders_pk').on(table.shipmentGroupId, table.orderId),
])

export const excelImportTemplates = pgTable('excel_import_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  mappings: jsonb('mappings').$type<Array<{
    field: string
    excelColumn: string
    fixedValue?: string
    extraColumns?: string[]
    joinSeparator?: string
  }>>().notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const carrierTemplates = pgTable('carrier_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  // 양식이 특정 택배사에 종속되지 않도록 nullable. 자유 양식은 NULL.
  carrierId: varchar('carrier_id', { length: 50 }),
  name: varchar('name', { length: 200 }).notNull(),
  columns: jsonb('columns').$type<Array<{
    header: string
    field: string
    width: number
    required: boolean
  }>>().notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

// ─── Phase 4: Inventory Management ─────────────────────────────

export const adjustmentReasonEnum = pgEnum('adjustment_reason', [
  'incoming',
  'defective',
  'physical_count',
  'return',
  'order_ship',
  'order_cancel',
  'other',
])

export const inventory = pgTable(
  'inventory',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    sku: varchar('sku', { length: 100 }).notNull(),
    productName: text('product_name').notNull(),
    warehouseZone: varchar('warehouse_zone', { length: 100 }),
    sectorCode: varchar('sector_code', { length: 100 }),
    optionName: varchar('option_name', { length: 200 }),
    packagingUnit: varchar('packaging_unit', { length: 200 }),
    totalStock: integer('total_stock').notNull().default(0),
    reservedStock: integer('reserved_stock').notNull().default(0),
    availableStock: integer('available_stock').notNull().default(0),
    defectiveStock: integer('defective_stock').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('inventory_user_sku_warehouse').on(table.userId, table.sku, table.warehouseZone, table.sectorCode),
    index('inventory_user_sku_idx').on(table.userId, table.sku),
    index('inventory_user_id').on(table.userId),
  ],
)

export const inventoryHistory = pgTable(
  'inventory_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventory.id),
    userId: uuid('user_id').notNull(),
    adjustmentReason: adjustmentReasonEnum('adjustment_reason').notNull(),
    delta: integer('delta').notNull(),
    previousTotal: integer('previous_total').notNull(),
    newTotal: integer('new_total').notNull(),
    note: text('note'),
    orderId: uuid('order_id').references(() => orders.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('inventory_history_inventory_id').on(table.inventoryId),
    index('inventory_history_order_id').on(table.orderId),
  ],
)

export const inventoryAdjustmentSlips = pgTable(
  'inventory_adjustment_slips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventory.id),
    userId: uuid('user_id').notNull(),
    sku: varchar('sku', { length: 100 }).notNull(),
    productName: text('product_name').notNull(),
    optionName: varchar('option_name', { length: 200 }),
    warehouseZone: varchar('warehouse_zone', { length: 100 }),
    sectorCode: varchar('sector_code', { length: 100 }),
    adjustmentReason: adjustmentReasonEnum('adjustment_reason').notNull(),
    delta: integer('delta').notNull(),
    note: text('note'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    registeredBy: uuid('registered_by'),
    registeredByName: text('registered_by_name'),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('inventory_adjustment_slips_user_created').on(table.userId, table.createdAt),
    index('inventory_adjustment_slips_status').on(table.status),
    index('inventory_adjustment_slips_inventory_id').on(table.inventoryId),
  ],
)

// ─── Phase 5: Product Management ────────────────────────────────

export const productStatusEnum = pgEnum('product_status', [
  'draft',
  'active',
  'inactive',
  'deleted',
])

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    internalSku: varchar('internal_sku', { length: 100 }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    basePrice: numeric('base_price', { precision: 12, scale: 2 }).notNull(),
    costPrice: numeric('cost_price', { precision: 12, scale: 2 }),
    categoryId: varchar('category_id', { length: 100 }),
    warehouseLocation: varchar('warehouse_location', { length: 200 }),
    defaultCarrierId: varchar('default_carrier_id', { length: 50 }),
    /** SaaS 등록 배송비(원가) — 재고관리에서 수동 입력. NULL 허용. (Phase 8 / migration 012) */
    shippingCost: numeric('shipping_cost', { precision: 12, scale: 2 }),
    /** 재고관리 대상 여부. TRUE 인 상품만 재고관리 페이지에 노출/추적. (migration 023) */
    manageInventory: boolean('manage_inventory').notNull().default(false),
    status: productStatusEnum('status').notNull().default('draft'),
    images: jsonb('images').$type<Array<{ url: string; sortOrder: number }>>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('products_user_sku').on(table.userId, table.internalSku),
    index('products_user_status').on(table.userId, table.status),
  ],
)

export const productChangeLogs = pgTable(
  'product_change_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    fieldName: varchar('field_name', { length: 100 }).notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('product_change_logs_product_id').on(table.productId),
    index('product_change_logs_created_at').on(table.createdAt),
  ],
)

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 100 }).notNull(),
    optionName: varchar('option_name', { length: 200 }),
    optionValues: jsonb('option_values').$type<Record<string, string>>(),
    priceAdjustment: numeric('price_adjustment', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('product_variants_product_sku').on(table.productId, table.sku),
  ],
)

export const productMarketplaceLinks = pgTable(
  'product_marketplace_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceProductId: varchar('marketplace_product_id', { length: 200 }).notNull(),
    marketplaceCategoryId: varchar('marketplace_category_id', { length: 200 }),
    marketplaceCategoryName: text('marketplace_category_name'),
    syncStatus: varchar('sync_status', { length: 50 }).notNull().default('synced'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    rawData: jsonb('raw_data').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('product_marketplace_links_unique').on(
      table.marketplaceId,
      table.marketplaceProductId,
    ),
    index('product_marketplace_links_product').on(table.productId),
  ],
)

export const categoryMappings = pgTable(
  'category_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    internalCategory: varchar('internal_category', { length: 200 }).notNull(),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceCategoryId: varchar('marketplace_category_id', { length: 200 }).notNull(),
    marketplaceCategoryName: text('marketplace_category_name'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('category_mappings_unique').on(
      table.userId,
      table.internalCategory,
      table.marketplaceId,
    ),
  ],
)

// ─── 매핑 시스템 ────────────────────────────────────────────────
// 기존 product_name_mappings / product_option_mappings / product_bundle_items
// 3개 테이블은 migration 021 에서 drop. 신규 mapping_codes 기반 시스템은
// 다음 phase 에서 추가 (사방넷 매핑코드 방식 — 1차: 마켓수집 → 매핑코드,
// 2차: 매핑코드 → 재고 SKU N개 + 각 수량).

// ─── Company Settings ────────────────────────────────────────────

export const companySettings = pgTable(
  'company_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    companyName: varchar('company_name', { length: 200 }).notNull().default(''),
    phone: varchar('phone', { length: 50 }).notNull().default(''),
    address: text('address').notNull().default(''),
    zipCode: varchar('zip_code', { length: 10 }).notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('company_settings_user_id').on(table.userId),
  ],
)

// ─── Phase 8: Marketplace Inquiries ────────────────────────────
// 마켓플레이스 문의 수집 (migration 013).
// Coupang 우선 — Naver는 별도 quick task로 분리.
// inquiry_type: 'product' | 'callcenter' | 'online' (Coupang 3종)

export const inquiries = pgTable(
  'inquiries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceInquiryId: varchar('marketplace_inquiry_id', { length: 255 }).notNull(),
    marketplaceOrderId: varchar('marketplace_order_id', { length: 255 }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    inquiryType: varchar('inquiry_type', { length: 50 }).notNull(),
    question: text('question').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    rawData: jsonb('raw_data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('inquiries_user_market_external_uniq').on(
      table.userId, table.marketplaceId, table.marketplaceInquiryId,
    ),
    index('inquiries_order_id_idx').on(table.orderId),
    index('inquiries_user_marketplace_idx').on(table.userId, table.marketplaceId),
  ],
)

// ─── Job Logs ───────────────────────────────────────────────────

export const jobLogs = pgTable('job_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobType: varchar('job_type', { length: 50 }).notNull(),
  marketplaceId: varchar('marketplace_id', { length: 50 }),
  connectionId: uuid('connection_id'),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  ordersCollected: integer('orders_collected'),
  claimsCollected: integer('claims_collected'),
  errorMessage: text('error_message'),
  /**
   * 사용자에게 진행 상황을 보여주는 사람용 메시지.
   * 워커가 단계별로 갱신: "변경된 주문 조회 중...", "5건 처리 중 (3/5)" 등.
   */
  progressMessage: text('progress_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})


// ─── Admin: Account Management (Phase 9) ────────────────────────

export const userRoleEnum = pgEnum('user_role', ['super_admin', 'admin'])

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: uuid('id').primaryKey(), // FK to auth.users.id (declared in migration SQL)
    email: text('email').notNull(),
    role: userRoleEnum('role').notNull().default('admin'),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by'), // FK to user_profiles.id, nullable for backfilled rows
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivatedBy: uuid('deactivated_by'),
  },
  (table) => [
    uniqueIndex('user_profiles_email_idx').on(table.email),
    index('user_profiles_role_idx').on(table.role),
    index('user_profiles_active_idx').on(table.deactivatedAt),
  ],
)

export type UserProfile = typeof userProfiles.$inferSelect
export type UserRole = (typeof userRoleEnum.enumValues)[number]

export const auditActionEnum = pgEnum('audit_action', [
  'account.create',
  'account.role_change',
  'account.deactivate',
  'account.reactivate',
  'account.password_reset',
  'password.self_change',
])

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id').notNull(),
    action: auditActionEnum('action').notNull(),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_actor_idx').on(table.actorId, table.createdAt),
    index('audit_logs_target_idx').on(table.targetId, table.createdAt),
    index('audit_logs_action_idx').on(table.action, table.createdAt),
  ],
)

export type AuditLog = typeof auditLogs.$inferSelect
export type AuditAction = (typeof auditActionEnum.enumValues)[number]

// ─── Admin: Dev Log ─────────────────────────────────────────────
// 개발 작업 일지 — 팀 3인(상철/기환/지은) 공동 기록.
// 사용자별 데이터 아님 (관리자 메뉴 내부 공유 테이블).

export const DEV_LOG_AUTHORS = ["상철", "기환", "지은"] as const
export type DevLogAuthor = (typeof DEV_LOG_AUTHORS)[number]

export const devLogEntries = pgTable(
  "dev_log_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    author: varchar("author", { length: 20 }).notNull().$type<DevLogAuthor>(),
    logDate: date("log_date").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("dev_log_entries_log_date_idx").on(table.logDate, table.createdAt),
  ],
)

// ─── Mapping Codes (사방넷 방식) ─────────────────────────────────
// migration 022 — Phase B 매핑 시스템 재설계.
//
// mapping_codes      = 셀러가 정의하는 통합 식별자 (예: "MC-A001")
// mapping_sources    = 마켓상품(±옵션) → 매핑코드 (1차/2차 매핑 통합)
// mapping_components = 매핑코드 → 내부 SKU + 수량 (단품=1, 세트=N)
//
// option_id 는 NOT NULL DEFAULT '' — Postgres unique 가 NULL 동등 비교를
// 하지 않아 중복 방지가 깨지는 이슈를 피하기 위함.

export const mappingCodes = pgTable(
  'mapping_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    code: varchar('code', { length: 100 }).notNull(),
    name: text('name').notNull(),
    note: text('note'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mapping_codes_user_code_uniq').on(table.userId, table.code),
    index('mapping_codes_user_active_idx').on(table.userId, table.isActive),
  ],
)

export const mappingSources = pgTable(
  'mapping_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    mappingCodeId: uuid('mapping_code_id')
      .notNull()
      .references(() => mappingCodes.id, { onDelete: 'cascade' }),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceProductId: varchar('marketplace_product_id', { length: 100 }).notNull(),
    marketplaceOptionId: varchar('marketplace_option_id', { length: 100 }).notNull().default(''),
    productNameSnapshot: text('product_name_snapshot'),
    optionNameSnapshot: text('option_name_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mapping_sources_user_market_product_option_uniq').on(
      table.userId,
      table.marketplaceId,
      table.marketplaceProductId,
      table.marketplaceOptionId,
    ),
    index('mapping_sources_code_id_idx').on(table.mappingCodeId),
    index('mapping_sources_user_market_idx').on(table.userId, table.marketplaceId),
  ],
)

export const mappingComponents = pgTable(
  'mapping_components',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    mappingCodeId: uuid('mapping_code_id')
      .notNull()
      .references(() => mappingCodes.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 100 }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mapping_components_user_code_sku_uniq').on(
      table.userId,
      table.mappingCodeId,
      table.sku,
    ),
    index('mapping_components_code_id_idx').on(table.mappingCodeId),
    index('mapping_components_user_sku_idx').on(table.userId, table.sku),
  ],
)

// ─── Scan Logs ───────────────────────────────────────────────────
// 바코드 스캔 이력 — 정상/중복/비정상 모두 기록 (migration 020).
// 상세 페이지의 "바코드 스캔 여부" 섹션에서 이 테이블을 조회한다.

export const scanLogs = pgTable(
  'scan_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    trackingNumber: varchar('tracking_number', { length: 100 }).notNull(),
    /** ok=정상, duplicate=중복, not_found=비정상 */
    status: varchar('status', { length: 20 }).notNull(),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('scan_logs_order_id_idx').on(table.orderId),
    index('scan_logs_shipment_id_idx').on(table.shipmentId),
    index('scan_logs_user_id_scanned_at_idx').on(table.userId, table.scannedAt),
  ],
)
