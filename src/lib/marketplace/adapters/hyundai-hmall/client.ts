import ky from 'ky'
import { XMLBuilder, XMLParser } from 'fast-xml-parser'

const DEFAULT_HYUNDAI_HMALL_API_BASE = 'https://openapi.hmall.com/front'

export interface HyundaiHmallClientCredentials {
  oauser_id: string
  oause_key: string
  base_url?: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
})

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: false,
})

function normalizeBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, '')
  if (!trimmed || trimmed === 'https://api.hmall.com' || trimmed === 'http://api.hmall.com') {
    return DEFAULT_HYUNDAI_HMALL_API_BASE
  }
  if (trimmed === 'http://openapi.hmall.com/front') return DEFAULT_HYUNDAI_HMALL_API_BASE
  return trimmed
}

export function buildHmallXml(rows: Array<Record<string, unknown>>): string {
  return builder.build({
    Root: {
      Dataset: {
        '@_id': 'dsInput',
        rows: {
          row: rows,
        },
      },
    },
  })
}

export function parseHmallXml<T = Record<string, unknown>>(xml: string): T {
  return parser.parse(xml) as T
}

/**
 * Create a ky HTTP client pre-configured for Hyundai Hmall API calls.
 */
export function createHyundaiHmallClient(credentials: HyundaiHmallClientCredentials) {
  return ky.create({
    prefixUrl: normalizeBaseUrl(credentials.base_url),
    headers: {
      oauserId: credentials.oauser_id,
      oauseKey: credentials.oause_key,
      Accept: 'application/xml',
      'Content-Type': 'application/xml;charset=UTF-8',
    },
    timeout: 30_000,
    retry: {
      limit: 1,
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  })
}
