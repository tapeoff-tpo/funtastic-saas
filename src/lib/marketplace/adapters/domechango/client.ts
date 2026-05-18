import crypto from 'node:crypto'
import ky, { type Options } from 'ky'

export const DOMECHANGO_API_BASE = 'https://api.wholesaledepot.co.kr'
export const DEFAULT_DOMECHANGO_SERVER_IP = '208.77.246.15'

export interface DomechangoCredentials {
  apiKey: string
  secureKey: string
  serverIp?: string
}

export interface DomechangoResponse<T> {
  statusCode: string
  data: T
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatKstDateTime(date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return [
    kst.getUTCFullYear(),
    pad(kst.getUTCMonth() + 1),
    pad(kst.getUTCDate()),
  ].join('-')
    + ' '
    + [
      pad(kst.getUTCHours()),
      pad(kst.getUTCMinutes()),
      pad(kst.getUTCSeconds()),
    ].join(':')
}

function createAuthorization(credentials: DomechangoCredentials, method: string): string {
  const signedTime = formatKstDateTime()
  const serverIp = credentials.serverIp || DEFAULT_DOMECHANGO_SERVER_IP
  const message = `${signedTime}${method.toUpperCase()}${serverIp}`
  const signature = crypto
    .createHmac('sha256', credentials.secureKey)
    .update(message)
    .digest('hex')

  return JSON.stringify({
    apikey: credentials.apiKey,
    'signed-time': signedTime,
    signature,
  })
}

export function createDomechangoClient(credentials: DomechangoCredentials) {
  return {
    request: async <T>(method: string, endpoint: string, options: Options = {}) => {
      const upperMethod = method.toUpperCase()
      const client = ky.create({
        prefixUrl: DOMECHANGO_API_BASE,
        timeout: 30_000,
        retry: {
          limit: 2,
          statusCodes: [408, 429, 500, 502, 503, 504],
        },
        headers: {
          'content-type': 'application/json;charset=UTF-8',
          authorization: createAuthorization(credentials, upperMethod),
        },
      })

      return client(endpoint.replace(/^\//, ''), {
        ...options,
        method: upperMethod,
      }).json<DomechangoResponse<T>>()
    },
  }
}
