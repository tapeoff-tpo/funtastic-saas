import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { parseOrderExcel } from '@/lib/orders/excel-import'
import { db } from '@/lib/db'
import { excelImportTemplates, orders, orderItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { generateInternalNo } from '@/lib/orders/internal-no'
import { DEFAULT_ORDER_IMPORT_TEMPLATES, findDefaultOrderImportTemplate } from '@/lib/orders/default-import-templates'
import type { OrderImportMapping } from '@/lib/orders/excel-import-fields'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { parseImportedOrderedAt } from '@/lib/orders/import-date'
import { normalizeImportedOrderItem } from '@/lib/orders/import-normalize'
import { splitPhonePair } from '@/lib/orders/phone-normalize'

/**
 * POST /api/orders/import
 *
 * Upload an Excel file to import orders.
 * FormData: file (.xlsx), marketplaceId (string)
 *
 * Rows with the same orderNumber are split into separate internal orders per item.
 * Skips duplicate orders (same marketplaceId + marketplaceOrderId).
 */

function importedLineAmount(item: { totalAmount: number; quantity: number }): number {
  return item.totalAmount || 0
}

function itemSplitRawData(rawData: Record<string, unknown>, meta: Record<string, unknown>): Record<string, unknown> {
  return {
    ...rawData,
    itemSplit: meta,
  }
}

function isSabangnetImportSource(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => {
    const normalized = value?.trim().toLowerCase()
    return !!normalized && (normalized.includes('sabangnet') || normalized.includes('사방넷'))
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const marketplaceId = formData.get('marketplaceId') as string | null
  const marketplaceName = String(formData.get('marketplaceName') ?? '').trim()
  const templateId = formData.get('templateId') as string | null

  if (!file) {
    return NextResponse.json({ error: '파일을 선택해주세요' }, { status: 400 })
  }

  if (!marketplaceId) {
    return NextResponse.json({ error: '마켓플레이스를 입력해주세요' }, { status: 400 })
  }

  // Validate file extension
  if (!file.name.endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Excel 파일(.xlsx)만 업로드할 수 있습니다' }, { status: 400 })
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    let templateMappings: OrderImportMapping[] | undefined
    if (templateId?.startsWith('default:')) {
      const template = DEFAULT_ORDER_IMPORT_TEMPLATES.find((candidate) => candidate.id === templateId)
      if (!template) {
        return NextResponse.json({ error: '선택한 기본 엑셀 양식을 찾을 수 없습니다' }, { status: 400 })
      }
      templateMappings = template.mappings
    } else if (templateId) {
      const [template] = await db
        .select({ mappings: excelImportTemplates.mappings })
        .from(excelImportTemplates)
        .where(and(eq(excelImportTemplates.id, templateId), eq(excelImportTemplates.userId, workspaceUserId)))
        .limit(1)

      if (!template) {
        return NextResponse.json({ error: '선택한 엑셀 양식을 찾을 수 없습니다' }, { status: 400 })
      }
      templateMappings = template.mappings
    } else {
      templateMappings = findDefaultOrderImportTemplate(marketplaceId, marketplaceName)?.mappings
    }

    // Parse Excel
    const parseResult = await parseOrderExcel(buffer, templateMappings)

    if (parseResult.rows.length === 0 && parseResult.errors.length > 0) {
      return NextResponse.json({
        inserted: 0,
        skipped: 0,
        errors: parseResult.errors,
      })
    }

    if (parseResult.rows.length === 0) {
      return NextResponse.json({
        inserted: 0,
        skipped: 0,
        errors: [{ row: 0, message: '데이터가 없습니다' }],
      })
    }

    // Group rows by orderNumber (same order may have multiple items)
    const orderMap = new Map<string, typeof parseResult.rows>()
    for (const row of parseResult.rows) {
      const existing = orderMap.get(row.orderNumber) || []
      existing.push(row)
      orderMap.set(row.orderNumber, existing)
    }

    let inserted = 0
    let skipped = 0
    const importErrors: Array<{ row: number; message: string }> = []

    // Use transaction for the entire batch
    await db.transaction(async (tx) => {
      for (const [orderNumber, items] of orderMap) {
        const collectedAt = new Date()
        const first = items[0]

        // Check if order already exists
        const existing = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(
            and(
              eq(orders.marketplaceId, marketplaceId),
              eq(orders.marketplaceOrderId, orderNumber),
            ),
          )
          .limit(1)

        if (existing.length > 0) {
          skipped++
          continue
        }

        const orderedAt = parseImportedOrderedAt(first.orderedAt)
        const buyerPhones = splitPhonePair(first.buyerPhone)
        const recipientPhones = splitPhonePair(first.recipientPhone)

        const normalizedItems = items.map((item) => normalizeImportedOrderItem(item, marketplaceId))
        const firstNormalized = normalizedItems[0]
        const isSabangnetImport = isSabangnetImportSource(marketplaceId, marketplaceName, file.name, templateId)
        const baseRawData = {
          ...(isSabangnetImport ? { source: 'sabangnet-import-xlsx' } : {}),
          collectionSource: isSabangnetImport ? 'sabangnet-excel' : 'order-excel',
          importTemplateId: templateId ?? null,
          sourceFileName: file.name,
          mallName: marketplaceName || marketplaceId,
        }
        const splitBase = {
          splitAt: new Date().toISOString(),
          totalParts: normalizedItems.length,
        }

        try {
          // Insert order
          const [newOrder] = await tx
            .insert(orders)
            .values({
              internalNo: generateInternalNo(),
              userId: workspaceUserId,
              connectionId: null,
              marketplaceId,
              marketplaceOrderId: orderNumber,
              status: 'new',
              buyerName: first.buyerName,
              buyerPhone: buyerPhones.phone1,
              buyerPhone2: buyerPhones.phone2,
              recipientName: first.recipientName,
              recipientPhone: recipientPhones.phone1,
              recipientPhone2: recipientPhones.phone2,
              shippingAddress: {
                zipCode: first.zipCode ?? '',
                address1: first.recipientAddress,
              },
              orderedAt,
              totalAmount: String(importedLineAmount(firstNormalized)),
              shippingFee: first.shippingFee == null ? null : String(first.shippingFee),
              deliveryMessage: first.deliveryMessage ?? null,
              rawData: itemSplitRawData(baseRawData, { ...splitBase, partIndex: 1, original: true }),
              collectedAt,
            })
            .returning({ id: orders.id })

          const orderItemValue = (orderId: string, item: typeof firstNormalized) => ({
            orderId,
            marketplaceItemId: item.marketplaceItemId ?? null,
            productName: item.productName,
            optionText: item.optionText ?? null,
            quantity: item.quantity,
            unitPrice: String(item.totalAmount / item.quantity),
            sku: item.sku ?? null,
          })

          await tx.insert(orderItems).values(orderItemValue(newOrder.id, firstNormalized))

          for (let index = 1; index < normalizedItems.length; index += 1) {
            const item = normalizedItems[index]
            const [copy] = await tx
              .insert(orders)
              .values({
                internalNo: generateInternalNo(),
                userId: workspaceUserId,
                connectionId: null,
                marketplaceId,
                marketplaceOrderId: orderNumber,
                status: 'new',
                buyerName: first.buyerName,
                buyerPhone: buyerPhones.phone1,
                buyerPhone2: buyerPhones.phone2,
                recipientName: first.recipientName,
                recipientPhone: recipientPhones.phone1,
                recipientPhone2: recipientPhones.phone2,
                shippingAddress: {
                  zipCode: first.zipCode ?? '',
                  address1: first.recipientAddress,
                },
                orderedAt,
                totalAmount: String(importedLineAmount(item)),
                shippingFee: first.shippingFee == null ? null : String(first.shippingFee),
                deliveryMessage: first.deliveryMessage ?? null,
                rawData: itemSplitRawData(baseRawData, { ...splitBase, partIndex: index + 1, originalOrderId: newOrder.id }),
                collectedAt,
                isCopy: true,
              })
              .returning({ id: orders.id })

            await tx.insert(orderItems).values(orderItemValue(copy.id, item))
          }

          inserted++
        } catch (error) {
          importErrors.push({
            row: 0,
            message: `주문 ${orderNumber}: ${error instanceof Error ? error.message : '저장 실패'}`,
          })
        }
      }
    })

    revalidatePath('/orders')
    revalidateTag('orders', 'max')

    return NextResponse.json({
      inserted,
      skipped,
      errors: [...parseResult.errors, ...importErrors],
    })
  } catch (error) {
    console.error('[OrderImport] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '파일 처리 중 오류가 발생했습니다' },
      { status: 500 },
    )
  }
}
