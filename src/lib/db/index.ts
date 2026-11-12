import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { DATABASE_IDLE_SECONDS, keepDatabaseAliveUntilIdle } from './connection-lifecycle'

const connectionString = process.env.DATABASE_URL!
const isServerless = Boolean(process.env.VERCEL && process.env.VERCEL_REGION)
const applicationName = ['funtastic-saas', process.env.VERCEL_ENV ?? 'local', process.env.VERCEL_REGION ?? 'local', process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8)].filter(Boolean).join(':').slice(0, 63)

const databaseGlobal = globalThis as typeof globalThis & { funtasticDatabaseClient?: ReturnType<typeof postgres> }
export const client = databaseGlobal.funtasticDatabaseClient ??= postgres(connectionString, {
  prepare: false,
  max: 1,
  idle_timeout: DATABASE_IDLE_SECONDS,
  max_lifetime: 300,
  connect_timeout: 10,
  connection: {
    application_name: applicationName,
    // Server-side fallback if the function is killed before its idle timer runs.
    // This never interrupts a query or an open transaction.
    ...(isServerless ? { idle_session_timeout: '30s' } : {}),
  },
})

export const db = drizzle(client, {
  schema,
  // Use Drizzle's query hook without enabling SQL/parameter debug logging.
  logger: { logQuery: () => keepDatabaseAliveUntilIdle() },
})
