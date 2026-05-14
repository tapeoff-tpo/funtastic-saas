import ky from 'ky'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function createFuntasticB2bClient(credentials: { api_key: string; base_url: string }) {
  return ky.create({
    prefixUrl: normalizeBaseUrl(credentials.base_url),
    hooks: {
      beforeRequest: [
        (request) => {
          request.headers.set('Authorization', `Bearer ${credentials.api_key}`)
          request.headers.set('Content-Type', 'application/json;charset=UTF-8')
          request.headers.set('Accept', 'application/json')
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
