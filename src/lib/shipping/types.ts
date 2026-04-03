/**
 * Shipping domain types and contracts.
 *
 * Defines the data shapes for invoice upload, shipment tracking,
 * combined shipping groups, and carrier templates.
 */

/** Upload status for tracking invoice upload lifecycle (per D-02) */
export type InvoiceUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'failed'
  | 'confirmed'

/** Carrier information */
export interface CarrierInfo {
  code: string
  koreanName: string
  englishName: string
}

/** Job data for BullMQ invoice upload workers */
export interface InvoiceUploadJobData {
  orderId: string
  shipmentId: string
  marketplaceId: string
  marketplaceOrderId: string
  connectionId: string
  trackingNumber: string
  carrierId: string
  attempt: number
}

/** Combined shipping group (per D-05/D-06) */
export interface ShipmentGroup {
  groupKey: string
  orders: string[]
  fulfillmentCode: string
  suggestedAction: string
  reason?: string
}

/** Carrier-specific Excel template column definition */
export interface CarrierTemplateColumn {
  header: string
  field: string
  width: number
  required: boolean
}

/** Carrier template for Excel export customization */
export interface CarrierTemplate {
  id: string
  carrierId: string
  name: string
  columns: CarrierTemplateColumn[]
  isDefault: boolean
  userId: string
}

/** Shipment record matching DB shipments table shape */
export interface ShipmentRecord {
  id: string
  orderId: string
  userId: string
  trackingNumber: string
  carrierId: string
  carrierName: string
  uploadStatus: InvoiceUploadStatus
  marketplaceUploadError: string | null
  uploadAttempts: number
  lastUploadAt: Date | null
  shippedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
