/**
 * Naver Commerce API client with OAuth2 token management.
 *
 * Manages access token lifecycle with proactive refresh
 * 5 minutes before expiry (Pitfall 3). Each request is
 * automatically authenticated with Bearer token.
 */

import bcrypt from 'bcryptjs'
import ky from 'ky'
import { MarketplaceAuthError } from '../../errors'
import type { NaverTokenResponse } from './types'

const NAVER_API_BASE = 'https://api.commerce.naver.com'
const NAVER_TOKEN_URL = `${NAVER_API_BASE}/external/v1/oauth2/token`

/** Token refresh buffer: refresh 5 minutes before expiry */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

export interface NaverClientState {
  accessToken: string | null
  tokenExpiresAt: number | null
}

/**
 * Create a ky HTTP client pre-configured for Naver Commerce API.
 * Automatically manages OAuth2 tokens with proactive refresh.
 */
export function createNaverClient(clientId: string, clientSecret: string) {
  const state: NaverClientState = {
    accessToken: null,
    tokenExpiresAt: null,
  }

  /**
   * Get a valid access token, refreshing proactively if needed.
   * Caches the token and refreshes 5 minutes before expiry.
   */
  async function getToken(): Promise<string> {
    const now = Date.now()

    // Return cached token if still valid (with 5-min buffer)
    if (state.accessToken && state.tokenExpiresAt && now < state.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return state.accessToken
    }

    // Request new token
    try {
      const timestamp = Date.now().toString()
      const hashed = bcrypt.hashSync(`${clientId}_${timestamp}`, clientSecret)
      const sign = Buffer.from(hashed).toString('base64')

      const res = await fetch(NAVER_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          timestamp,
          client_secret_sign: sign,
          grant_type: 'client_credentials',
          type: 'SELF',
        }).toString(),
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`${res.status} ${res.statusText}: ${body}`)
      }

      const response = await res.json() as NaverTokenResponse
      state.accessToken = response.access_token
      state.tokenExpiresAt = now + (response.expires_in * 1000)

      return state.accessToken
    } catch (error) {
      state.accessToken = null
      state.tokenExpiresAt = null
      throw new MarketplaceAuthError(
        'naver',
        `OAuth2 token request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  const client = ky.create({
    prefixUrl: NAVER_API_BASE,
    hooks: {
      beforeRequest: [
        async (request) => {
          const token = await getToken()
          request.headers.set('Authorization', `Bearer ${token}`)
          request.headers.set('Content-Type', 'application/json')
        },
      ],
    },
    timeout: 30_000,
    retry: {
      limit: 2,
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })

  return { client, getToken, getState: () => ({ ...state }) }
}
