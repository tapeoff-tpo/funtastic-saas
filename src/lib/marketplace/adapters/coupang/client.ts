/**
 * Coupang API client with HMAC-SHA256 request signing.
 *
 * Each request is signed with a per-request HMAC-SHA256 signature
 * that includes the HTTP method, path, query, and datetime.
 * Signatures use 2-digit year format: yyMMddTHHmmssZ (Pitfall 2).
 */

import { createHmac } from 'node:crypto'
import ky from 'ky'

const COUPANG_API_BASE = 'https://api-gateway.coupang.com'

/**
 * Format a date as Coupang datetime: yyMMddTHHmmssZ (2-digit year).
 * Per Coupang documentation, the signed-date uses 2-digit year, NOT 4-digit.
 */
export function formatCoupangDatetime(date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(-2)
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const HH = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${yy}${MM}${dd}T${HH}${mm}${ss}Z`
}

/**
 * Generate the Coupang CEA authorization header value.
 *
 * Message format: datetime + method + path + query   (no separators)
 * Header format: CEA algorithm=HmacSHA256, access-key={key}, signed-date={datetime}, signature={hex}
 *
 * NOTE: accessKey/secretKey are trimmed to remove any accidental whitespace
 *       that could have been introduced when storing credentials (copy-paste newlines).
 */
export function generateCoupangAuth(
  method: string,
  path: string,
  query: string,
  accessKey: string,
  secretKey: string,
): string {
  const cleanAccessKey = accessKey.replace(/\s+/g, '')
  const cleanSecretKey = secretKey.replace(/\s+/g, '')

  const datetime = formatCoupangDatetime(new Date())
  const message = `${datetime}${method}${path}${query}`
  const signature = createHmac('sha256', cleanSecretKey)
    .update(message)
    .digest('hex')

  if (process.env.COUPANG_DEBUG === '1') {
    // secret은 절대 로그하지 않음. 길이와 prefix만.
    console.log('[Coupang Sig]', {
      datetime,
      method,
      path,
      queryLen: query.length,
      messagePreview: message.slice(0, 120) + (message.length > 120 ? '...' : ''),
      accessKeyPrefix: cleanAccessKey.slice(0, 4),
      accessKeyLen: cleanAccessKey.length,
      secretKeyLen: cleanSecretKey.length,
    })
  }

  return `CEA algorithm=HmacSHA256, access-key=${cleanAccessKey}, signed-date=${datetime}, signature=${signature}`
}

/**
 * Create a ky HTTP client pre-configured for Coupang API calls.
 * Automatically signs each request with HMAC-SHA256.
 */
export function createCoupangClient(accessKey: string, secretKey: string, vendorId: string) {
  return ky.create({
    prefixUrl: COUPANG_API_BASE,
    hooks: {
      beforeRequest: [
        (request) => {
          const url = new URL(request.url)
          const path = url.pathname
          const query = url.search ? url.search.slice(1) : ''
          const method = request.method.toUpperCase()

          const auth = generateCoupangAuth(method, path, query, accessKey, secretKey)
          request.headers.set('Authorization', auth)
          request.headers.set('X-Requested-By', vendorId)
          request.headers.set('X-MARKET', 'KR')
          request.headers.set('Content-Type', 'application/json;charset=UTF-8')
        },
      ],
    },
    timeout: 30_000,
    retry: {
      limit: 2,
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })
}
