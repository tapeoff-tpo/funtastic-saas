import { after } from 'next/server'

export const DATABASE_IDLE_SECONDS = 2

/** Keep the invocation alive after the response so postgres.js's idle timer
 * can close its sockets before Vercel suspends the process. Start the grace
 * period AFTER the response, not when a possibly slow query starts.
 */
export function keepDatabaseAliveUntilIdle() {
  if (!process.env.VERCEL || !process.env.VERCEL_REGION) return
  after(() => new Promise<void>(resolve => {
    setTimeout(resolve, DATABASE_IDLE_SECONDS * 1000 + 100)
  }))
}
