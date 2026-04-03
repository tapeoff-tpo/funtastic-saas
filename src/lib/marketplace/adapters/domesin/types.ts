/**
 * Domesin (도매의신) API response types.
 *
 * TODO: Update types when API documentation becomes available.
 * These are minimal placeholder types for the stub adapter.
 */

/** Placeholder order type */
export interface DomesinOrder {
  id: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder claim type */
export interface DomesinClaim {
  id: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder product type */
export interface DomesinProduct {
  id: string
  status: string
  rawData: Record<string, unknown>
}
