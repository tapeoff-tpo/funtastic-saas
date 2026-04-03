import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  varchar,
  jsonb,
} from 'drizzle-orm/pg-core'

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
