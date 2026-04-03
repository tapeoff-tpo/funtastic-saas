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
  displayName: text('display_name').notNull(),
  authType: authTypeEnum('auth_type').notNull(),
  status: connectionStatusEnum('status').notNull().default('disconnected'),
  vaultSecretNames: jsonb('vault_secret_names').$type<string[]>().notNull(),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastErrorMessage: text('last_error_message'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

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
      .notNull()
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
