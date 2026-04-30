/**
 * ESM Trading API HTTP client with JWT authentication.
 *
 * The ESM Trading API uses a HS256 JWT in the Authorization header.
 */

import ky from 'ky'
import { createHmac } from 'crypto'
import type { EsmSiteType } from './types'

const ESM_API_BASE = 'https://sa2.esmplus.com'

function base64UrlEncode(value: string): string {
  return Buffer
    .from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function sign(value: string, secretKey: string): string {
  return createHmac('sha256', secretKey)
    .update(value)
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function createEsmJwt(credentials: {
  master_id: string
  secret_key: string
  seller_id: string
  site_type: EsmSiteType
}) {
  const header = base64UrlEncode(JSON.stringify({
    alg: 'HS256',
    typ: 'JWT',
    kid: credentials.master_id,
  }))
  const payload = base64UrlEncode(JSON.stringify({
    iss: 'funtastic-saas',
    sub: 'sell',
    aud: 'sa.esmplus.com',
    iat: Math.floor(Date.now() / 1000),
    ssi: `${credentials.site_type}:${credentials.seller_id}`,
  }))
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${sign(unsigned, credentials.secret_key)}`
}

/**
 * Create a ky HTTP client pre-configured for ESM Trading API calls.
 */
export function createEsmClient(credentials: {
  master_id: string
  secret_key: string
  seller_id: string
  site_type: EsmSiteType
}) {
  return ky.create({
    prefixUrl: ESM_API_BASE,
    hooks: {
      beforeRequest: [
        (request) => {
          request.headers.set('Authorization', `Bearer ${createEsmJwt(credentials)}`)
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
