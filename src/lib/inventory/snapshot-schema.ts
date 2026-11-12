import { pgTable, uuid, varchar, text, integer, timestamp, date, primaryKey, index } from 'drizzle-orm/pg-core'

export const inventoryMonthEndImports = pgTable('inventory_month_end_imports', {
  userId: uuid('user_id').notNull(),
  referenceMonth: varchar('reference_month', { length: 7 }).notNull(),
  sourceFileName: text('source_file_name').notNull(),
  sourceHash: varchar('source_hash', { length: 64 }).notNull(),
  rowCount: integer('row_count').notNull(),
  asOfDate: date('as_of_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.referenceMonth] })])

export const inventoryMonthEndStock = pgTable('inventory_month_end_stock', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  referenceMonth: varchar('reference_month', { length: 7 }).notNull(),
  sku: varchar('sku', { length: 100 }).notNull(),
  productName: text('product_name').notNull(),
  optionName: varchar('option_name', { length: 200 }),
  warehouseZone: varchar('warehouse_zone', { length: 100 }),
  sectorCode: varchar('sector_code', { length: 100 }),
  packagingUnit: varchar('packaging_unit', { length: 200 }),
  totalStock: integer('total_stock').notNull(),
  reservedStock: integer('reserved_stock').notNull().default(0),
  availableStock: integer('available_stock').notNull(),
  monthlyIncoming: integer('monthly_incoming').notNull().default(0),
  monthlyOutgoing: integer('monthly_outgoing').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => [index('inventory_month_end_user_month_sku_idx').on(table.userId, table.referenceMonth, table.sku)])
