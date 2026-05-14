import ky from 'ky'

export const SPECIALOFFER_API_BASE = 'https://specialoffer.kr'

export function createSpecialofferClient(credentials: { api_key: string }) {
  return ky.create({
    prefixUrl: SPECIALOFFER_API_BASE,
    headers: {
      Authorization: `Bearer ${credentials.api_key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36',
    },
    timeout: 30_000,
    retry: {
      limit: 2,
      methods: ['get'],
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })
}
