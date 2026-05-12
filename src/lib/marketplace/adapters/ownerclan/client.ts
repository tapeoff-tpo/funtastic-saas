import ky, { HTTPError, type KyInstance } from 'ky'

const OWNERCLAN_GRAPHQL_URL = 'https://api.ownerclan.com/v1/graphql'
const OWNERCLAN_AUTH_URL = 'https://auth.ownerclan.com/auth'
const OWNERCLAN_GRAPHQL_INTERVAL_MS = 2_500
const OWNERCLAN_RATE_LIMIT_BACKOFF_MS = 15_000
const OWNERCLAN_CLOUDFLARE_BACKOFF_MS = 60_000
const OWNERCLAN_HTTP_TIMEOUT_MS = 60_000

interface OwnerclanAuthResponse {
  token?: string
  accessToken?: string
  access_token?: string
  jwt?: string
}

export interface OwnerclanGraphqlResponse<T> {
  data?: T
  errors?: Array<{ message?: string }>
}

export class OwnerclanClient {
  private token: string | null = null
  private nextGraphqlRequestAt = 0

  constructor(
    private readonly credentials: { username: string; password: string; userType?: 'seller' | 'vendor' },
    private readonly http: KyInstance = ky.create({
      timeout: OWNERCLAN_HTTP_TIMEOUT_MS,
      retry: {
        limit: 2,
        statusCodes: [408, 500, 502, 503, 504],
      },
    }),
  ) {}

  async authenticate(): Promise<string> {
    if (this.token) return this.token

    const responseText = await this.http.post(OWNERCLAN_AUTH_URL, {
      json: {
        service: 'ownerclan',
        userType: this.credentials.userType ?? 'vendor',
        username: this.credentials.username,
        password: this.credentials.password,
      },
    }).text()

    const token = parseAuthToken(responseText)

    if (!token) {
      throw new Error('Ownerclan auth token was not returned')
    }

    this.token = token
    return token
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.graphqlRequest<T>(query, variables)
  }

  async mutate<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.graphqlRequest<T>(query, variables)
  }

  private async graphqlRequest<T>(query: string, variables?: Record<string, unknown>, attempt = 0): Promise<T> {
    const token = await this.authenticate()
    let response: OwnerclanGraphqlResponse<T>
    try {
      await this.waitForGraphqlSlot()
      response = await this.http.post(OWNERCLAN_GRAPHQL_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        json: {
          query,
          variables,
        },
      }).json<OwnerclanGraphqlResponse<T>>()
    } catch (error) {
      const enrichedError = await enrichHttpError(error)
      if (attempt === 0 && isRateLimitError(enrichedError)) {
        await sleep(OWNERCLAN_RATE_LIMIT_BACKOFF_MS)
        return this.graphqlRequest<T>(query, variables, attempt + 1)
      }
      if (attempt === 0 && isRetryableCloudflareError(enrichedError)) {
        await sleep(getRetryAfterMs(enrichedError) ?? OWNERCLAN_CLOUDFLARE_BACKOFF_MS)
        return this.graphqlRequest<T>(query, variables, attempt + 1)
      }
      throw enrichedError
    }

    if (response.errors && response.errors.length > 0) {
      const error = new Error(response.errors.map((error) => error.message ?? 'Unknown GraphQL error').join('; '))
      if (attempt === 0 && isRateLimitError(error)) {
        await sleep(OWNERCLAN_RATE_LIMIT_BACKOFF_MS)
        return this.graphqlRequest<T>(query, variables, attempt + 1)
      }
      throw error
    }

    if (!response.data) {
      throw new Error('Ownerclan GraphQL response did not include data')
    }

    return response.data
  }

  private async waitForGraphqlSlot(): Promise<void> {
    const now = Date.now()
    const waitMs = Math.max(0, this.nextGraphqlRequestAt - now)
    this.nextGraphqlRequestAt = Math.max(now, this.nextGraphqlRequestAt) + OWNERCLAN_GRAPHQL_INTERVAL_MS
    if (waitMs > 0) await sleep(waitMs)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return message.includes('too many requests') || message.includes('429')
}

function isRetryableCloudflareError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return message.includes('cloudflare_error') || message.includes('bad gateway') || message.includes('502')
}

function getRetryAfterMs(error: Error): number | undefined {
  const match = error.message.match(/"retry_after"\s*:\s*(\d+)/)
  if (!match) return undefined
  const seconds = Number(match[1])
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
}

async function enrichHttpError(error: unknown): Promise<Error> {
  if (error instanceof HTTPError) {
    const body = await error.response.text().catch(() => '')
    return new Error(`${error.message}${body ? `: ${body}` : ''}`)
  }
  return error instanceof Error ? error : new Error('Unknown Ownerclan HTTP error')
}

function parseAuthToken(responseText: string): string | undefined {
  const trimmed = responseText.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('eyJ')) return trimmed

  try {
    const parsed = JSON.parse(trimmed) as OwnerclanAuthResponse
    return parsed.token ?? parsed.accessToken ?? parsed.access_token ?? parsed.jwt
  } catch {
    return trimmed
  }
}

export function createOwnerclanClient(credentials: { username: string; password: string; userType?: 'seller' | 'vendor' }) {
  return new OwnerclanClient(credentials)
}
