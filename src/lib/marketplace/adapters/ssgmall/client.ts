import ky from 'ky'

const SSGMALL_API_BASE = 'https://eapi.ssgadm.com'

export function createSsgmallClient(apiKey: string) {
  return ky.create({
    prefixUrl: SSGMALL_API_BASE,
    headers: {
      Authorization: apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json;charset=UTF-8',
    },
    timeout: 30_000,
    retry: {
      limit: 1,
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })
}
