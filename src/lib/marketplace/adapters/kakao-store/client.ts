/**
 * 카카오톡스토어 API client with API key authentication.
 *
 * Uses API key authorization header for REST API calls.
 * JSON-based API.
 */

import ky from 'ky'

const KAKAO_STORE_API_BASE = 'https://store-api.kakao.com/api/v1'

/**
 * Create a ky HTTP client pre-configured for 카카오톡스토어 API calls.
 * Uses API key authentication via X-Api-Key header.
 */
export function createKakaoStoreClient(apiKey: string) {
  return ky.create({
    prefixUrl: KAKAO_STORE_API_BASE,
    hooks: {
      beforeRequest: [
        (request: Request) => {
          request.headers.set('X-Api-Key', apiKey)
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
}
