import ky from 'ky'
import { XMLBuilder, XMLParser } from 'fast-xml-parser'

const DEFAULT_HYUNDAI_HMALL_API_BASE = 'https://api.hmall.com'

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
    prefixUrl: credentials.base_url?.trim() || DEFAULT_HYUNDAI_HMALL_API_BASE,
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
