/**
 * POST /api/shipping/import
 *
 * Parse an uploaded Excel file for invoice data and match to orders.
 * Accepts multipart/form-data with Excel file + column mapping.
 */

import { NextRequest, NextResponse } from 'next/server'
import { parseInvoiceExcel, matchInvoicesToOrders } from '@/lib/shipping/excel/import'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'file is required' },
        { status: 400 },
      )
    }

    // Parse column mapping from form data
    const orderIdCol = Number(formData.get('orderIdCol') ?? 1)
    const trackingNumberCol = Number(formData.get('trackingNumberCol') ?? 2)
    const carrierCol = Number(formData.get('carrierCol') ?? 3)

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Parse Excel
    const parseResult = await parseInvoiceExcel(buffer, {
      orderIdCol,
      trackingNumberCol,
      carrierCol,
    })

    // Match to orders
    // TODO: Get userId from auth session
    const userId = 'placeholder-user-id'
    const matchResult = await matchInvoicesToOrders(parseResult.valid, userId)

    return NextResponse.json({
      matched: matchResult.matched,
      unmatched: matchResult.unmatched,
      invalid: parseResult.invalid,
    })
  } catch (error) {
    console.error('Excel import error:', error)
    return NextResponse.json(
      { error: 'Failed to parse Excel file' },
      { status: 500 },
    )
  }
}
