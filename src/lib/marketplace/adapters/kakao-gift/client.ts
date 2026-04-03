/**
 * 카카오선물하기 API client with API key authentication.
 *
 * Uses KakaoAK authorization header for REST API calls.
 * JSON-based API.
 */

import ky from 'ky'

const KAKAO_GIFT_API_BASE = 'https://gift-api.kakao.com/api/v1'

/**
 * Create a ky HTTP client pre-configured for 카카오선물하기 API calls.
 * Uses KakaoAK authorization for authentication.
 */
export function createKakaoGiftClient(apiKey: string) {
  return ky.create({
    prefixUrl: KAKAO_GIFT_API_BASE,
    hooks: {
      beforeRequest: [
        (request: Request) => {
          request.headers.set('Authorization', `KakaoAK ${apiKey}`)
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
