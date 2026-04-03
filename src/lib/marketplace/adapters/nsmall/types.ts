/**
 * NS Mall (NS홈쇼핑) API response types.
 *
 * TODO: Update types when API documentation becomes available.
 * These are minimal placeholder types for the stub adapter.
 */

/** Placeholder order type */
export interface NsmallOrder {
  id: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder claim type */
export interface NsmallClaim {
  id: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder product type */
export interface NsmallProduct {
  id: string
  status: string
  rawData: Record<string, unknown>
}
