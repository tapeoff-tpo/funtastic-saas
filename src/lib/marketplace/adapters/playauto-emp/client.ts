import ky from 'ky'

export const PLAYAUTO_EMP_API_BASE = 'http://playauto-api.playauto.co.kr/emp/v1'

export function createPlayautoEmpClient(credentials: { api_key: string; base_url?: string }) {
  return ky.create({
    prefixUrl: credentials.base_url?.trim() || PLAYAUTO_EMP_API_BASE,
    headers: {
      'X-API-KEY': credentials.api_key,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
    retry: {
      limit: 2,
      methods: ['get'],
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })
}
