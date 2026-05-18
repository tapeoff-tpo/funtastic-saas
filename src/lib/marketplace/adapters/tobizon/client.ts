import { createHmac } from 'node:crypto'
import ky from 'ky'
import type { TobizonCredentials, TobizonGoodsPayload, TobizonGoodsResponse } from './types'

const TOBIZON_API_BASE = 'http://api.tobizon.co.kr/vender'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatTobizonSignedTime(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00'

  return [
    `${value('year')}-${value('month')}-${value('day')}`,
    `${pad2(Number(value('hour')))}:${value('minute')}:${value('second')}`,
  ].join(' ')
}

export function createTobizonAuthorization(
  credentials: TobizonCredentials,
  signedTime: string = formatTobizonSignedTime()
): string {
  const message = `${signedTime}${credentials.secure_key}${credentials.client_server_ip}`
  const signature = createHmac('sha256', credentials.secure_key)
    .update(message)
    .digest('hex')

  return JSON.stringify({
    apikey: credentials.api_key,
    'signed-time': signedTime,
    signature,
  })
}

/**
 * Create a ky HTTP client pre-configured for Tobizon API calls.
 */
export function createTobizonClient(credentials: TobizonCredentials) {
  const client = ky.create({
    prefixUrl: TOBIZON_API_BASE,
    hooks: {
      beforeRequest: [
        (request) => {
          request.headers.set('Authorization', createTobizonAuthorization(credentials))
          request.headers.set('Content-Type', 'application/json;charset=UTF-8')
        },
      ],
    },
    timeout: 30_000,
    retry: {
      limit: 2,
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })

  return {
    postGoods(payload: TobizonGoodsPayload) {
      return client.post('goods', { json: payload }).json<TobizonGoodsResponse>()
    },
    putGoods(payload: TobizonGoodsPayload) {
      return client.put('goods', { json: payload }).json<TobizonGoodsResponse>()
    },
  }
}
