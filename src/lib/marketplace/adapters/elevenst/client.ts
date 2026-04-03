/**
 * 11st (11번가) API client with API key authentication and XML parsing.
 *
 * 11st Open API uses simple API key auth via the `openapikey` header.
 * Responses are XML, parsed via fast-xml-parser.
 */

import ky from 'ky'
import { XMLParser } from 'fast-xml-parser'

const ELEVENST_API_BASE = 'https://openapi.11st.co.kr'

/** Shared XML parser instance with consistent options */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false, // Keep all values as strings to preserve codes like '202', '303'
})

/**
 * Parse an XML response string to a typed object.
 * Uses fast-xml-parser with attribute support and trimmed values.
 */
export function parseXmlResponse<T>(xmlText: string): T {
  return xmlParser.parse(xmlText) as T
}

/**
 * Create a ky HTTP client pre-configured for 11st Open API calls.
 * Automatically sets the openapikey header on each request.
 */
export function createElevenstClient(apiKey: string) {
  return ky.create({
    prefixUrl: ELEVENST_API_BASE,
    hooks: {
      beforeRequest: [
        (request) => {
          request.headers.set('openapikey', apiKey)
          request.headers.set('Content-Type', 'application/xml;charset=UTF-8')
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
