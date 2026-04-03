import IORedis from 'ioredis'

/**
 * Shared Redis connection for BullMQ queues and workers.
 *
 * BullMQ requires `maxRetriesPerRequest: null` to work correctly.
 * The connection is reused across all queues in the same process.
 */

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

connection.on('error', (err: Error) => {
  console.error(
    `[Redis] Connection error: ${err.message}. ` +
      `Ensure Redis is running at ${REDIS_URL} (docker compose up -d)`
  )
})

connection.on('connect', () => {
  console.log(`[Redis] Connected to ${REDIS_URL}`)
})

/** Factory function for testing — returns a fresh connection */
export function getRedisConnection(url?: string): IORedis {
  return new IORedis(url || REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}
