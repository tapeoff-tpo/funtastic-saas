/**
 * Domechango (도매창고) API response types.
 *
 * TODO: Update types when API documentation becomes available.
 * These are minimal placeholder types for the stub adapter.
 */

/** Placeholder order type */
export interface DomechangoOrder {
  id: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder claim type */
export interface DomechangoClaim {
  id: string
  status: string
  rawData: Record<string, unknown>
}

/** Placeholder product type */
export interface DomechangoProduct {
  id: string
  status: string
  rawData: Record<string, unknown>
}
