import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Drizzle db before imports
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import {
  DEFAULT_CARRIER_TEMPLATES,
  AVAILABLE_ORDER_FIELDS,
} from '@/lib/shipping/excel/templates'
import {
  getCarrierTemplates,
  getCarrierTemplateById,
  createCarrierTemplate,
  updateCarrierTemplate,
  deleteCarrierTemplate,
  seedDefaultTemplates,
} from '@/lib/shipping/template-queries'
import { db } from '@/lib/db'

describe('DEFAULT_CARRIER_TEMPLATES', () => {
  it('should have 5 entries for primary carriers', () => {
    expect(DEFAULT_CARRIER_TEMPLATES).toHaveLength(5)
    const carrierIds = DEFAULT_CARRIER_TEMPLATES.map((t) => t.carrierId)
    expect(carrierIds).toContain('CJGLS')
    expect(carrierIds).toContain('HANJIN')
    expect(carrierIds).toContain('HYUNDAI')
    expect(carrierIds).toContain('EPOST')
    expect(carrierIds).toContain('KGB')
  })

  it('each template has required columns: recipientName, recipientPhone, shippingAddress, productName, quantity', () => {
    const requiredFields = [
      'recipientName',
      'recipientPhone',
      'shippingAddress.zipCode',
      'shippingAddress.address1',
      'productName',
      'quantity',
    ]

    for (const template of DEFAULT_CARRIER_TEMPLATES) {
      const fields = template.columns.map((c) => c.field)
      for (const required of requiredFields) {
        expect(fields).toContain(required)
      }
    }
  })

  it('each template has isDefault set to true', () => {
    for (const template of DEFAULT_CARRIER_TEMPLATES) {
      expect(template.isDefault).toBe(true)
    }
  })
})

describe('AVAILABLE_ORDER_FIELDS', () => {
  it('lists all exportable order fields with Korean labels', () => {
    expect(AVAILABLE_ORDER_FIELDS.length).toBeGreaterThanOrEqual(15)

    const fieldNames = AVAILABLE_ORDER_FIELDS.map((f) => f.field)
    expect(fieldNames).toContain('orderId')
    expect(fieldNames).toContain('marketplaceOrderId')
    expect(fieldNames).toContain('recipientName')
    expect(fieldNames).toContain('recipientPhone')
    expect(fieldNames).toContain('productName')
    expect(fieldNames).toContain('quantity')
    expect(fieldNames).toContain('trackingNumber')
    expect(fieldNames).toContain('status')

    // Check Korean labels exist
    for (const field of AVAILABLE_ORDER_FIELDS) {
      expect(field.label).toBeTruthy()
      expect(field.label.length).toBeGreaterThan(0)
    }
  })
})

describe('Template CRUD queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createCarrierTemplate inserts a new template and returns its id', async () => {
    const mockReturning = vi.fn().mockResolvedValue([{ id: 'template-1' }])
    const mockValues = vi.fn().mockReturnValue({ returning: mockReturning })
    ;(db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: mockValues,
    })

    const result = await createCarrierTemplate({
      carrierId: 'CJGLS',
      name: 'CJ대한통운',
      columns: [],
      isDefault: false,
      userId: 'user-1',
    })

    expect(result).toEqual({ id: 'template-1' })
    expect(db.insert).toHaveBeenCalled()
  })

  it('getCarrierTemplates returns templates filtered by userId', async () => {
    const mockTemplates = [
      { id: 't1', userId: 'user-1', carrierId: 'CJGLS', name: 'CJ' },
    ]
    const mockWhere = vi.fn().mockResolvedValue(mockTemplates)
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    ;(db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: mockFrom,
    })

    const result = await getCarrierTemplates('user-1')

    expect(result).toEqual(mockTemplates)
    expect(db.select).toHaveBeenCalled()
  })

  it('updateCarrierTemplate modifies columns and name', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined)
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
    ;(db.update as ReturnType<typeof vi.fn>).mockReturnValue({ set: mockSet })

    await updateCarrierTemplate('template-1', {
      name: 'Updated Name',
      columns: [{ header: 'Test', field: 'test', width: 10, required: false }],
    })

    expect(db.update).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalled()
  })

  it('deleteCarrierTemplate removes the template', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined)
    ;(db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
      where: mockWhere,
    })

    await deleteCarrierTemplate('template-1')

    expect(db.delete).toHaveBeenCalled()
    expect(mockWhere).toHaveBeenCalled()
  })
})
