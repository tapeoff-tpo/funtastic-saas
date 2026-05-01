import ky from 'ky'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function createFuntasticB2bClient(apiBaseUrl: string, apiToken: string) {
  return ky.create({
    prefixUrl: normalizeBaseUrl(apiBaseUrl),
    headers: {
      Authorization: `Bearer ${apiToken.trim()}`,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
    retry: {
      limit: 2,
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })
}
