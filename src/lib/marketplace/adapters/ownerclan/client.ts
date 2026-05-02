import ky, { HTTPError, type KyInstance } from 'ky'

const OWNERCLAN_GRAPHQL_URL = 'https://api.ownerclan.com/v1/graphql'
const OWNERCLAN_AUTH_URL = 'https://auth.ownerclan.com/auth'

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

  constructor(
    private readonly credentials: { username: string; password: string; userType?: 'seller' | 'vendor' },
    private readonly http: KyInstance = ky.create({
      timeout: 30_000,
      retry: {
        limit: 2,
        statusCodes: [408, 429, 500, 502, 503, 504],
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
    const token = await this.authenticate()
    let response: OwnerclanGraphqlResponse<T>
    try {
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
      throw await enrichHttpError(error)
    }

    if (response.errors && response.errors.length > 0) {
      throw new Error(response.errors.map((error) => error.message ?? 'Unknown GraphQL error').join('; '))
    }

    if (!response.data) {
      throw new Error('Ownerclan GraphQL response did not include data')
    }

    return response.data
  }

  async mutate<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = await this.authenticate()
    let response: OwnerclanGraphqlResponse<T>
    try {
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
      throw await enrichHttpError(error)
    }

    if (response.errors && response.errors.length > 0) {
      throw new Error(response.errors.map((error) => error.message ?? 'Unknown GraphQL error').join('; '))
    }

    if (!response.data) {
      throw new Error('Ownerclan GraphQL response did not include data')
    }

    return response.data
  }
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
