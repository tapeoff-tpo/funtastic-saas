import IORedis from 'ioredis'

/**
 * Shared Redis connection for BullMQ queues and workers.
 *
 * BullMQ requires `maxRetriesPerRequest: null` to work correctly.
 * Uses lazy initialization so env vars are available at connection time.
 *
 * IMPORTANT: Always use getConnection() — never import at module top-level.
 */

let _connection: IORedis | null = null

function getUrl() {
  return process.env.REDIS_URL || 'redis://localhost:6379'
}

export function getConnection(): IORedis {
  if (!_connection) {
    const url = getUrl()
    console.log(`[Redis] Connecting to ${url.replace(/\/\/.*@/, '//***@')}`)
    _connection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
    _connection.on('error', (err: Error) => {
      console.error(`[Redis] Connection error: ${err.message}`)
    })
    _connection.on('connect', () => {
      console.log(`[Redis] Connected successfully`)
    })
  }
  return _connection
}

/** Factory function for testing — returns a fresh connection */
export function getRedisConnection(url?: string): IORedis {
  return new IORedis(url || getUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}
