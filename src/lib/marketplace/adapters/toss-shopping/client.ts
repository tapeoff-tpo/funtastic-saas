import ky from 'ky'
import { MarketplaceAuthError } from '../../errors'
import type { TossShoppingTokenResponse } from './types'

const TOSS_SHOPPING_API_BASE = 'https://shopping-fep.toss.im'
const TOSS_SHOPPING_TOKEN_URL = 'https://oauth2.cert.toss.im/token'
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

export interface TossShoppingClientState {
  accessToken: string | null
  tokenExpiresAt: number | null
}

export function createTossShoppingClient(accessKey: string, secretKey: string) {
  const state: TossShoppingClientState = {
    accessToken: null,
    tokenExpiresAt: null,
  }

  async function getToken(): Promise<string> {
    const now = Date.now()
    if (state.accessToken && state.tokenExpiresAt && now < state.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return state.accessToken
    }

    try {
      const res = await fetch(TOSS_SHOPPING_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json; charset=UTF-8',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: accessKey.trim(),
          client_secret: secretKey.trim(),
          scope: 'toss-shopping-fep:write',
        }).toString(),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ''}`)
      }

      const token = await res.json() as TossShoppingTokenResponse
      state.accessToken = token.access_token
      state.tokenExpiresAt = now + token.expires_in * 1000
      return token.access_token
    } catch (error) {
      state.accessToken = null
      state.tokenExpiresAt = null
      throw new MarketplaceAuthError(
        'toss-shopping',
        `Toss Shopping token request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  const client = ky.create({
    prefixUrl: TOSS_SHOPPING_API_BASE,
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
