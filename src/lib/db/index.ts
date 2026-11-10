import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

const databaseGlobal = globalThis as typeof globalThis & { funtasticDatabaseClient?: ReturnType<typeof postgres> }
export const client = databaseGlobal.funtasticDatabaseClient ??= postgres(connectionString, {
  prepare: false, // Required for Supabase connection pooling (Transaction mode)
  max: 1,
  idle_timeout: 2,
  max_lifetime: 300,
  connect_timeout: 10,
})

export const db = drizzle(client, { schema })
