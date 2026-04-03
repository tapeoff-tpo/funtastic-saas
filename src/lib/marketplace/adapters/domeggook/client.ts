/**
 * Domeggook (도매꾹) API client with OpenAPI key authentication.
 *
 * Domeggook supports both XML and JSON endpoints. This client defaults
 * to JSON but provides an XML parsing utility via fast-xml-parser.
 * API details are best-effort (per D-03).
 */

import ky from 'ky'
import { XMLParser } from 'fast-xml-parser'

const DOMEGGOOK_API_BASE = 'https://domeggook.com/api/v1'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
})

/**
 * Parse an XML response string into a typed object.
 */
export function parseXmlResponse<T>(xml: string): T {
  return xmlParser.parse(xml) as T
}

/**
 * Create a ky HTTP client pre-configured for Domeggook API calls.
 * Sets the API key in the Authorization header.
 */
export function createDomeggookClient(apiKey: string) {
  return ky.create({
    prefixUrl: DOMEGGOOK_API_BASE,
    hooks: {
      beforeRequest: [
        (request) => {
          request.headers.set('Authorization', `Bearer ${apiKey}`)
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
}
