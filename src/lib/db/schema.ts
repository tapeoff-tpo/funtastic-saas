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
} from 'drizzle-orm/pg-core'

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

// ─── Phase 2: Order Management ──────────────────────────────────

export const orderStatusEnum = pgEnum('order_status', [
  'new',
  'confirmed',
  'preparing',
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
])

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    connectionId: uuid('connection_id')
      .references(() => marketplaceConnections.id),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceOrderId: varchar('marketplace_order_id', { length: 200 }).notNull(),
    status: orderStatusEnum('status').notNull().default('new'),
    previousStatus: orderStatusEnum('previous_status'),
    buyerName: varchar('buyer_name', { length: 200 }).notNull(),
    buyerPhone: varchar('buyer_phone', { length: 50 }),
    recipientName: varchar('recipient_name', { length: 200 }).notNull(),
    recipientPhone: varchar('recipient_phone', { length: 50 }),
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
    rawData: jsonb('raw_data').$type<Record<string, unknown>>(),
    marketplaceStatus: varchar('marketplace_status', { length: 100 }),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('orders_marketplace_unique').on(
      table.marketplaceId,
      table.marketplaceOrderId,
    ),
    index('orders_user_status').on(table.userId, table.status),
    index('orders_ordered_at').on(table.orderedAt),
  ],
)

export const orderItems = pgTable('order_items', {
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
  fulfillmentCode: varchar('fulfillment_code', { length: 50 }).default('normal'),
})

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
  carrierId: varchar('carrier_id', { length: 50 }).notNull(),
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
    totalStock: integer('total_stock').notNull().default(0),
    reservedStock: integer('reserved_stock').notNull().default(0),
    availableStock: integer('available_stock').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('inventory_user_sku').on(table.userId, table.sku),
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

// ─── Product Name Mappings (Phase 5+) ──────────────────────────
// Maps marketplace product names to internal display names for shipping labels.
// marketplace_name is the exact text from orderItems.productName.
// display_name is what gets printed on shipping labels / 송장.

export const productNameMappings = pgTable(
  'product_name_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceName: text('marketplace_name').notNull(),
    displayName: text('display_name').notNull(),
    pickingLocation: varchar('picking_location', { length: 100 }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('product_name_mappings_unique').on(
      table.userId,
      table.marketplaceId,
      table.marketplaceName,
    ),
    index('product_name_mappings_user').on(table.userId),
  ],
)

// Product option mappings — links (marketplace, productName, optionText) → variantSku
// Used when an order arrives with a specific option like "색상: 빨강"
// to identify which internal variant to pick.
export const productOptionMappings = pgTable(
  'product_option_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    marketplaceId: varchar('marketplace_id', { length: 50 }).notNull(),
    marketplaceName: text('marketplace_name').notNull(),
    optionText: text('option_text').notNull(),
    variantSku: varchar('variant_sku', { length: 100 }).notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('product_option_mappings_unique').on(
      table.userId,
      table.marketplaceId,
      table.marketplaceName,
      table.optionText,
    ),
    index('product_option_mappings_lookup').on(
      table.userId,
      table.marketplaceId,
      table.marketplaceName,
    ),
  ],
)

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
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
