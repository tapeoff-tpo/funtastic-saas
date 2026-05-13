import ky, { type KyInstance } from 'ky'
import { XMLParser } from 'fast-xml-parser'

const DOMEGGOOK_API_BASE = 'https://domeggook.com'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
})

export function parseXmlResponse<T>(xml: string): T {
  return xmlParser.parse(xml) as T
}

export function createDomeggookClient(apiKey: string) {
  void apiKey
  return ky.create({
    prefixUrl: DOMEGGOOK_API_BASE,
    hooks: {
      beforeRequest: [
        (request) => {
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

export async function readDomeggookJson<T>(
  client: KyInstance,
  searchParams: Record<string, string | number | undefined>,
): Promise<T> {
  const response = await client.get('ssl/api/', {
    searchParams: Object.fromEntries(
      Object.entries(searchParams).filter(([, value]) => value !== undefined && value !== ''),
    ) as Record<string, string | number>,
  })
  const text = await response.text()
  const trimmed = text.trim()

  if (trimmed.startsWith('<')) {
    throw new Error('Domeggook returned HTML instead of JSON. Check the API URL, Private API permission, and session credentials.')
  }

  return JSON.parse(trimmed) as T
}
