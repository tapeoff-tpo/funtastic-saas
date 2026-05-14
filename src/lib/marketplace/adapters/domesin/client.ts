import ky from 'ky'

export const DOMESIN_API_BASE = 'https://www.domesin.com'
export const DOMESIN_DATA_API_BASE = 'http://data.domesin.com'

export function createDomesinClient() {
  return ky.create({
    timeout: 30_000,
    retry: {
      limit: 2,
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })
}

export async function postDomesinJson<T>(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<T> {
  return createDomesinClient()
    .post(`${DOMESIN_API_BASE}${endpoint}`, {
      headers: { 'content-type': 'application/json' },
      json: payload,
    })
    .json<T>()
}

export async function postDomesinForm<T>(
  endpoint: string,
  payload: Record<string, string | number | undefined>,
): Promise<T> {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== '') body.set(key, String(value))
  }

  return createDomesinClient()
    .post(`${DOMESIN_DATA_API_BASE}${endpoint}`, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    .json<T>()
}
