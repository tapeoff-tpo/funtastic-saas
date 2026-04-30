import ky from 'ky'

const KAKAO_SHOPPING_API_BASE = 'https://kapi.kakao.com'

export function createKakaoStoreClient(credentials: {
  admin_app_key: string
  seller_app_key: string
  channel_ids?: string
}) {
  return ky.create({
    prefixUrl: KAKAO_SHOPPING_API_BASE,
    hooks: {
      beforeRequest: [
        (request: Request) => {
          request.headers.set('Authorization', `KakaoAK ${credentials.admin_app_key}`)
          request.headers.set('Target-Authorization', `KakaoAK ${credentials.seller_app_key}`)
          request.headers.set('channel-ids', credentials.channel_ids || '101')
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
