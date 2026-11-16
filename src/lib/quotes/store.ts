import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  companySettings,
  products,
  quoteItems,
  quoteSaleAttachments,
  quoteSaleItems,
  quoteSales,
  quotes,
} from '@/lib/db/schema'
import { calculateQuoteTotals, calculateSalesMarginTotals, parseQuoteNumber, type SalesStatus } from './quote-calculations'

export type QuoteWorkspaceItem = {
  id?: string
  productId?: string | null
  productCode?: string
  name?: string
  spec?: string
  qty?: number | string
  price?: number | string
  cost?: number | string
  wholesalePrice?: number | string
  vatIncluded?: boolean
  note?: string
}

export type QuoteWorkspaceTracking = {
  id?: string | number
  status?: 'before' | 'completed'
  date?: string
  memo?: string
  amount?: number | string
}

export type QuoteWorkspaceAttachment = {
  id: string
  fileName: string
  contentType: string
  fileSize: number
  createdAt: string
}

export type QuoteWorkspaceSale = {
  id?: string
  saleNumber?: string
  saleDate?: string
  quoteDate?: string
  clientName?: string
  representativeName?: string
  contactName?: string
  contactPhone?: string
  businessRegistrationNumber?: string
  taxInvoiceEmail?: string
  address?: string
  recipientName?: string
  recipientPhone?: string
  deliveryMessage?: string
  recipientTitle?: string
  requestedDueDate?: string
  status?: SalesStatus
  includeShipping?: boolean
  shippingFee?: number | string
  shippingCost?: number | string
  shippingVatIncluded?: boolean
  internalMemo?: string
  attachments?: QuoteWorkspaceAttachment[]
  items?: QuoteWorkspaceItem[]
  shipments?: QuoteWorkspaceTracking[]
  payments?: QuoteWorkspaceTracking[]
}

export type QuoteSupplier = {
  reg: string
  name: string
  rep: string
  addr: string
  biz: string
  type: string
  tel: string
  bankAccount?: string
}

export type QuoteWorkspaceQuote = {
  id?: string
  salesId?: string | null
  date?: string
  recipient?: string
  recipientTitle?: string
  intro?: string
  supplier?: QuoteSupplier
  notes?: string[]
  items?: QuoteWorkspaceItem[]
  printCount?: number
  lastPrintedAt?: string | null
}

export type QuoteCatalogItem = {
  id: string
  sku: string
  name: string
  spec: string
  cost: number | null
  location: string
}

export type QuoteWorkspaceData = {
  sales: QuoteWorkspaceSale[]
  quotes: QuoteWorkspaceQuote[]
  catalog: QuoteCatalogItem[]
  supplier: QuoteSupplier
}

const DEFAULT_SUPPLIER: QuoteSupplier = {
  reg: '', name: '', rep: '', addr: '', biz: '', type: '', tel: '', bankAccount: '',
}

// Keep multipart uploads below Vercel's reliable serverless request envelope,
// while retaining a finite count per shared sales record.
export const MAX_QUOTE_SALE_ATTACHMENTS = 20
export const MAX_QUOTE_SALE_ATTACHMENT_BYTES = 4 * 1024 * 1024

const cleanText = (value: unknown, limit = 4_000) => String(value ?? '').trim().slice(0, limit)
const cleanDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : null
const numberOrZero = (value: unknown) => Math.max(0, parseQuoteNumber(value as number | string) ?? 0)
const asNumeric = (value: number) => String(Math.round(value * 100) / 100)

function clientId(value: unknown, prefix: string) {
  const current = cleanText(value, 160)
  return current || `${prefix}-${crypto.randomUUID()}`
}

function detailsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizedAttachments(rows: unknown): QuoteWorkspaceAttachment[] {
  const source = Array.isArray(rows) ? rows.slice(0, MAX_QUOTE_SALE_ATTACHMENTS) : []
  return source.flatMap((row) => {
    const attachment = detailsRecord(row)
    const id = cleanText(attachment.id, 100)
    const fileName = cleanText(attachment.fileName, 500)
    // Old browser-only attachment metadata cannot be downloaded from the
    // shared workspace, so expose only persisted UUID-backed attachments.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !fileName) return []
    return [{
      id,
      fileName,
      contentType: cleanText(attachment.contentType, 160) || 'application/octet-stream',
      fileSize: Math.max(0, Math.floor(numberOrZero(attachment.fileSize))),
      createdAt: cleanText(attachment.createdAt, 80),
    }]
  })
}

function normalizedTracking(rows: unknown, includeAmount = false): QuoteWorkspaceTracking[] {
  const source = Array.isArray(rows) ? rows.slice(0, 100) : []
  return source.map((row, index) => {
    const item = detailsRecord(row)
    return {
      id: cleanText(item.id, 120) || String(index + 1),
      status: item.status === 'completed' ? 'completed' : 'before',
      date: cleanDate(item.date) ?? '',
      memo: cleanText(item.memo, 1_000),
      ...(includeAmount ? { amount: numberOrZero(item.amount) } : {}),
    }
  })
}

function normalizedItems(items: unknown): QuoteWorkspaceItem[] {
  const source = Array.isArray(items) ? items.slice(0, 1_000) : []
  return source.map((row, index) => {
    const item = detailsRecord(row)
    return {
      id: cleanText(item.id, 120) || String(index + 1),
      productId: cleanText(item.productId, 100) || null,
      productCode: cleanText(item.productCode, 100),
      name: cleanText(item.name, 1_000),
      spec: cleanText(item.spec, 500),
      qty: Math.round(numberOrZero(item.qty)),
      price: numberOrZero(item.price),
      cost: numberOrZero(item.cost),
      wholesalePrice: numberOrZero(item.wholesalePrice),
      vatIncluded: Boolean(item.vatIncluded),
      note: cleanText(item.note, 1_000),
    }
  })
}

function normalizedSale(input: QuoteWorkspaceSale): Required<Omit<QuoteWorkspaceSale, 'attachments' | 'items' | 'shipments' | 'payments'>> & {
  id: string
  attachments: QuoteWorkspaceAttachment[]
  items: QuoteWorkspaceItem[]
  shipments: QuoteWorkspaceTracking[]
  payments: QuoteWorkspaceTracking[]
} {
  return {
    id: clientId(input.id, 'sale'),
    saleNumber: cleanText(input.saleNumber, 80),
    saleDate: cleanDate(input.saleDate) ?? new Date().toISOString().slice(0, 10),
    quoteDate: cleanDate(input.quoteDate) ?? cleanDate(input.saleDate) ?? new Date().toISOString().slice(0, 10),
    clientName: cleanText(input.clientName, 1_000),
    representativeName: cleanText(input.representativeName, 300),
    contactName: cleanText(input.contactName, 300),
    contactPhone: cleanText(input.contactPhone, 200),
    businessRegistrationNumber: cleanText(input.businessRegistrationNumber, 100),
    taxInvoiceEmail: cleanText(input.taxInvoiceEmail, 320),
    address: cleanText(input.address, 2_000),
    recipientName: cleanText(input.recipientName, 300),
    recipientPhone: cleanText(input.recipientPhone, 200),
    deliveryMessage: cleanText(input.deliveryMessage, 2_000),
    recipientTitle: cleanText(input.recipientTitle, 300),
    requestedDueDate: cleanDate(input.requestedDueDate) ?? '',
    status: input.status === 'inProgress' || input.status === 'blocked' || input.status === 'completed' ? input.status : 'pending',
    includeShipping: Boolean(input.includeShipping),
    shippingFee: numberOrZero(input.shippingFee),
    shippingCost: numberOrZero(input.shippingCost),
    shippingVatIncluded: input.shippingVatIncluded !== false,
    internalMemo: cleanText(input.internalMemo, 8_000),
    attachments: normalizedAttachments(input.attachments),
    items: normalizedItems(input.items),
    shipments: normalizedTracking(input.shipments),
    payments: normalizedTracking(input.payments, true),
  }
}

function normalizedSupplier(input: unknown): QuoteSupplier {
  const source = detailsRecord(input)
  return {
    reg: cleanText(source.reg, 100), name: cleanText(source.name, 500), rep: cleanText(source.rep, 300),
    addr: cleanText(source.addr, 2_000), biz: cleanText(source.biz, 500), type: cleanText(source.type, 500),
    tel: cleanText(source.tel, 200), bankAccount: cleanText(source.bankAccount, 1_000),
  }
}

function normalizedQuote(input: QuoteWorkspaceQuote) {
  return {
    id: clientId(input.id, 'quote'),
    salesId: cleanText(input.salesId, 160) || null,
    date: cleanDate(input.date) ?? new Date().toISOString().slice(0, 10),
    recipient: cleanText(input.recipient, 1_000),
    recipientTitle: cleanText(input.recipientTitle, 300),
    intro: cleanText(input.intro, 2_000),
    supplier: normalizedSupplier(input.supplier),
    notes: Array.isArray(input.notes) ? input.notes.slice(0, 100).map((note) => cleanText(note, 2_000)) : [],
    items: normalizedItems(input.items),
  }
}

async function productLookup(userId: string, items: QuoteWorkspaceItem[]) {
  const codes = [...new Set(items.map((item) => cleanText(item.productCode, 100)).filter(Boolean))]
  if (!codes.length) return new Map<string, { id: string; name: string; cost: number | null }>()
  const rows = await db.select({ id: products.id, sku: products.internalSku, name: products.name, costPrice: products.costPrice })
    .from(products)
    .where(and(eq(products.userId, userId), ne(products.status, 'deleted'), inArray(products.internalSku, codes)))
  return new Map(rows.map((row) => [row.sku, { id: row.id, name: row.name, cost: row.costPrice === null ? null : Number(row.costPrice) }]))
}

function latestTracking(rows: QuoteWorkspaceTracking[]) {
  const complete = rows.length > 0 && rows.every((row) => row.status === 'completed')
  const date = rows.filter((row) => row.status === 'completed').map((row) => row.date).sort().at(-1) ?? null
  return { status: complete ? 'completed' : 'pending', date: date || null }
}

export async function listQuoteCatalog(userId: string): Promise<QuoteCatalogItem[]> {
  const rows = await db.select({ id: products.id, sku: products.internalSku, name: products.name, costPrice: products.costPrice, location: products.warehouseLocation, metadata: products.metadata })
    .from(products)
    .where(and(eq(products.userId, userId), ne(products.status, 'deleted')))
    .orderBy(asc(products.internalSku))
  return rows.map((row) => {
    const metadata = detailsRecord(row.metadata)
    const esa = detailsRecord(metadata.esa009m)
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      spec: cleanText(esa['규격정보'] ?? metadata.specification, 500),
      cost: row.costPrice === null ? null : Number(row.costPrice),
      location: row.location ?? '',
    }
  })
}

export async function getQuoteSupplier(userId: string): Promise<QuoteSupplier> {
  const [row] = await db.select().from(companySettings).where(eq(companySettings.userId, userId)).limit(1)
  if (!row) return DEFAULT_SUPPLIER
  return {
    reg: row.businessRegistrationNumber,
    name: row.companyName,
    rep: row.representativeName,
    addr: [row.zipCode, row.address].filter(Boolean).join(' '),
    biz: row.businessType,
    type: row.businessItem,
    tel: row.phone,
    bankAccount: row.bankAccount,
  }
}

export async function saveQuoteSale(input: { userId: string; actorUserId: string; sale: QuoteWorkspaceSale }): Promise<QuoteWorkspaceSale> {
  const sale = normalizedSale(input.sale)
  const catalog = await productLookup(input.userId, sale.items)
  const resolvedItems = sale.items.map((item) => {
    const catalogItem = catalog.get(item.productCode ?? '')
    return {
      ...item,
      productId: catalogItem?.id ?? item.productId ?? null,
      name: item.name || catalogItem?.name || '',
      // A selected master product supplies the initial cost in the editor.  Once
      // saved, however, the submitted line cost is the historical snapshot and
      // must not be overwritten just because the item master changed later.
      cost: numberOrZero(item.cost),
    }
  })
  const totals = calculateSalesMarginTotals({
    items: resolvedItems.map((item) => ({ qty: item.qty, price: item.price, cost: item.cost, vatIncluded: item.vatIncluded })),
    includeShipping: sale.includeShipping,
    shippingFee: sale.shippingFee,
    shippingVatIncluded: sale.shippingVatIncluded,
    shippingCost: sale.shippingCost,
  })
  const shipping = latestTracking(sale.shipments)
  const payment = latestTracking(sale.payments)
  const details = {
    quoteDate: sale.quoteDate, representativeName: sale.representativeName, contactName: sale.contactName,
    contactPhone: sale.contactPhone, businessRegistrationNumber: sale.businessRegistrationNumber,
    taxInvoiceEmail: sale.taxInvoiceEmail, address: sale.address, recipientName: sale.recipientName,
    recipientPhone: sale.recipientPhone, deliveryMessage: sale.deliveryMessage, recipientTitle: sale.recipientTitle,
    requestedDueDate: sale.requestedDueDate, includeShipping: sale.includeShipping, shippingFee: sale.shippingFee,
    shippingCost: sale.shippingCost, shippingVatIncluded: sale.shippingVatIncluded, internalMemo: sale.internalMemo,
    shipments: sale.shipments, payments: sale.payments,
  }
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: quoteSales.id }).from(quoteSales)
      .where(and(eq(quoteSales.userId, input.userId), eq(quoteSales.clientId, sale.id))).limit(1)
    const values = {
      saleNumber: sale.saleNumber || null, saleDate: sale.saleDate, customerName: sale.clientName,
      contactName: sale.contactName, status: sale.status, shippingStatus: shipping.status,
      shippingDate: shipping.date, paymentStatus: payment.status, paymentDate: payment.date,
      memo: sale.internalMemo || null, details,
      subtotalAmount: asNumeric(totals.subtotalGross ?? 0), vatAmount: asNumeric(totals.totalVat ?? 0),
      totalAmount: asNumeric(totals.totalGross ?? 0), totalCost: asNumeric(totals.totalCost ?? 0),
      grossProfit: asNumeric(totals.totalProfit ?? 0), updatedByUserId: input.actorUserId, updatedAt: new Date(),
    }
    const parent = existing
      ? (await tx.update(quoteSales).set(values).where(eq(quoteSales.id, existing.id)).returning({ id: quoteSales.id }))[0]
      : (await tx.insert(quoteSales).values({ ...values, userId: input.userId, clientId: sale.id, createdByUserId: input.actorUserId }).returning({ id: quoteSales.id }))[0]
    await tx.delete(quoteSaleItems).where(eq(quoteSaleItems.saleId, parent.id))
    if (resolvedItems.length) {
      await tx.insert(quoteSaleItems).values(resolvedItems.map((item, sortOrder) => ({
        userId: input.userId, saleId: parent.id, productId: item.productId || null, sku: item.productCode || null,
        productName: item.name || '', optionName: item.spec || '', quantity: Math.round(numberOrZero(item.qty)),
        unitPrice: asNumeric(numberOrZero(item.price)), unitCostSnapshot: asNumeric(numberOrZero(item.cost)),
        vatIncluded: Boolean(item.vatIncluded), note: item.note || '', sortOrder,
      })))
    }
    return parent
  })
  return { ...sale, items: resolvedItems, id: sale.id, dbId: result.id } as QuoteWorkspaceSale
}

export async function deleteQuoteSale(input: { userId: string; clientId: string }) {
  await db.delete(quoteSales).where(and(eq(quoteSales.userId, input.userId), eq(quoteSales.clientId, input.clientId)))
}

async function quoteSaleByClientId(userId: string, clientId: string) {
  const [sale] = await db.select({ id: quoteSales.id }).from(quoteSales)
    .where(and(eq(quoteSales.userId, userId), eq(quoteSales.clientId, cleanText(clientId, 160)))).limit(1)
  return sale ?? null
}

function attachmentMetadata(row: {
  id: string
  fileName: string
  contentType: string
  fileSize: number
  createdAt: Date
}): QuoteWorkspaceAttachment {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    fileSize: Number(row.fileSize),
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listQuoteSaleAttachments(input: { userId: string; saleClientId: string }): Promise<QuoteWorkspaceAttachment[]> {
  const sale = await quoteSaleByClientId(input.userId, input.saleClientId)
  if (!sale) return []
  const rows = await db.select({
    id: quoteSaleAttachments.id,
    fileName: quoteSaleAttachments.fileName,
    contentType: quoteSaleAttachments.contentType,
    fileSize: quoteSaleAttachments.fileSize,
    createdAt: quoteSaleAttachments.createdAt,
  }).from(quoteSaleAttachments)
    .where(and(eq(quoteSaleAttachments.userId, input.userId), eq(quoteSaleAttachments.saleId, sale.id)))
    .orderBy(asc(quoteSaleAttachments.createdAt), asc(quoteSaleAttachments.id))
  return rows.map(attachmentMetadata)
}

export async function addQuoteSaleAttachment(input: {
  userId: string
  actorUserId: string
  saleClientId: string
  fileName: string
  contentType: string
  fileBuffer: ArrayBuffer
}): Promise<QuoteWorkspaceAttachment> {
  if (input.fileBuffer.byteLength <= 0 || input.fileBuffer.byteLength > MAX_QUOTE_SALE_ATTACHMENT_BYTES) {
    throw new Error('첨부파일은 파일당 4MB 이하만 저장할 수 있습니다.')
  }
  const sale = await quoteSaleByClientId(input.userId, input.saleClientId)
  if (!sale) throw new Error('영업건을 먼저 저장한 후 첨부파일을 추가해주세요.')
  const existing = await db.select({ id: quoteSaleAttachments.id }).from(quoteSaleAttachments)
    .where(and(eq(quoteSaleAttachments.userId, input.userId), eq(quoteSaleAttachments.saleId, sale.id)))
    .limit(MAX_QUOTE_SALE_ATTACHMENTS)
  if (existing.length >= MAX_QUOTE_SALE_ATTACHMENTS) {
    throw new Error(`첨부파일은 영업건당 최대 ${MAX_QUOTE_SALE_ATTACHMENTS}개까지 저장할 수 있습니다.`)
  }
  const fileName = cleanText(input.fileName, 500) || '첨부파일'
  const contentType = cleanText(input.contentType, 160) || 'application/octet-stream'
  const [created] = await db.insert(quoteSaleAttachments).values({
    userId: input.userId,
    saleId: sale.id,
    fileName,
    contentType,
    fileSize: input.fileBuffer.byteLength,
    fileData: Buffer.from(input.fileBuffer),
    createdByUserId: input.actorUserId,
  }).returning({
    id: quoteSaleAttachments.id,
    fileName: quoteSaleAttachments.fileName,
    contentType: quoteSaleAttachments.contentType,
    fileSize: quoteSaleAttachments.fileSize,
    createdAt: quoteSaleAttachments.createdAt,
  })
  if (!created) throw new Error('첨부파일을 저장하지 못했습니다.')
  return attachmentMetadata(created)
}

export async function getQuoteSaleAttachment(input: { userId: string; saleClientId: string; attachmentId: string }) {
  const sale = await quoteSaleByClientId(input.userId, input.saleClientId)
  if (!sale) return null
  const [attachment] = await db.select({
    id: quoteSaleAttachments.id,
    fileName: quoteSaleAttachments.fileName,
    contentType: quoteSaleAttachments.contentType,
    fileSize: quoteSaleAttachments.fileSize,
    fileData: quoteSaleAttachments.fileData,
  }).from(quoteSaleAttachments).where(and(
    eq(quoteSaleAttachments.userId, input.userId),
    eq(quoteSaleAttachments.saleId, sale.id),
    eq(quoteSaleAttachments.id, input.attachmentId),
  )).limit(1)
  if (!attachment) return null
  return {
    ...attachment,
    fileSize: Number(attachment.fileSize),
    fileData: Buffer.isBuffer(attachment.fileData) ? attachment.fileData : Buffer.from(attachment.fileData),
  }
}

export async function deleteQuoteSaleAttachment(input: { userId: string; saleClientId: string; attachmentId: string }) {
  const sale = await quoteSaleByClientId(input.userId, input.saleClientId)
  if (!sale) return false
  const [deleted] = await db.delete(quoteSaleAttachments).where(and(
    eq(quoteSaleAttachments.userId, input.userId),
    eq(quoteSaleAttachments.saleId, sale.id),
    eq(quoteSaleAttachments.id, input.attachmentId),
  )).returning({ id: quoteSaleAttachments.id })
  return Boolean(deleted)
}

export async function saveQuoteRecord(input: { userId: string; actorUserId: string; quote: QuoteWorkspaceQuote }): Promise<QuoteWorkspaceQuote> {
  const quote = normalizedQuote(input.quote)
  const catalog = await productLookup(input.userId, quote.items)
  const resolvedItems = quote.items.map((item) => {
    const catalogItem = catalog.get(item.productCode ?? '')
    // Keep the quoted line's cost snapshot stable on later edits.  The client
    // pre-fills a new line from the shared item master when a SKU is selected.
    return { ...item, productId: catalogItem?.id ?? item.productId ?? null, name: item.name || catalogItem?.name || '', cost: numberOrZero(item.cost) }
  })
  const totals = calculateQuoteTotals(resolvedItems.map((item) => ({ qty: item.qty, price: item.price, vatIncluded: item.vatIncluded })))
  const [sale] = quote.salesId
    ? await db.select({ id: quoteSales.id }).from(quoteSales).where(and(eq(quoteSales.userId, input.userId), eq(quoteSales.clientId, quote.salesId))).limit(1)
    : []
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: quotes.id, printCount: quotes.printCount, lastPrintedAt: quotes.lastPrintedAt }).from(quotes)
      .where(and(eq(quotes.userId, input.userId), eq(quotes.clientId, quote.id))).limit(1)
    const values = {
      saleId: sale?.id ?? null, issueDate: quote.date, recipient: quote.recipient, recipientTitle: quote.recipientTitle,
      intro: quote.intro, supplierSnapshot: quote.supplier, notes: quote.notes, details: { salesId: quote.salesId },
      subtotalAmount: asNumeric(totals.supply), vatAmount: asNumeric(totals.vat), totalAmount: asNumeric(totals.total),
      updatedByUserId: input.actorUserId, updatedAt: new Date(),
    }
    const parent = existing
      ? (await tx.update(quotes).set(values).where(eq(quotes.id, existing.id)).returning({ id: quotes.id, printCount: quotes.printCount, lastPrintedAt: quotes.lastPrintedAt }))[0]
      : (await tx.insert(quotes).values({ ...values, userId: input.userId, clientId: quote.id, createdByUserId: input.actorUserId }).returning({ id: quotes.id, printCount: quotes.printCount, lastPrintedAt: quotes.lastPrintedAt }))[0]
    await tx.delete(quoteItems).where(eq(quoteItems.quoteId, parent.id))
    if (resolvedItems.length) {
      await tx.insert(quoteItems).values(resolvedItems.map((item, sortOrder) => ({
        userId: input.userId, quoteId: parent.id, productId: item.productId || null, sku: item.productCode || null,
        productName: item.name || '', optionName: item.spec || '', quantity: Math.round(numberOrZero(item.qty)),
        unitPrice: asNumeric(numberOrZero(item.price)), unitCostSnapshot: asNumeric(numberOrZero(item.cost)),
        vatIncluded: Boolean(item.vatIncluded), note: item.note || '', sortOrder,
      })))
    }
    return parent
  })
  return { ...quote, items: resolvedItems, id: quote.id, printCount: result.printCount, lastPrintedAt: result.lastPrintedAt?.toISOString() ?? null } as QuoteWorkspaceQuote
}

export async function deleteQuoteRecord(input: { userId: string; clientId: string }) {
  await db.delete(quotes).where(and(eq(quotes.userId, input.userId), eq(quotes.clientId, input.clientId)))
}

export async function markQuotePrinted(input: { userId: string; clientId: string }) {
  const [row] = await db.select({ id: quotes.id, printCount: quotes.printCount }).from(quotes)
    .where(and(eq(quotes.userId, input.userId), eq(quotes.clientId, input.clientId))).limit(1)
  if (!row) return null
  const [updated] = await db.update(quotes).set({ printCount: row.printCount + 1, lastPrintedAt: new Date(), updatedAt: new Date() })
    .where(eq(quotes.id, row.id)).returning({ printCount: quotes.printCount, lastPrintedAt: quotes.lastPrintedAt })
  return { printCount: updated.printCount, lastPrintedAt: updated.lastPrintedAt?.toISOString() ?? null }
}

export async function getQuoteWorkspace(userId: string): Promise<QuoteWorkspaceData> {
  const [saleRows, quoteRows, catalog, supplier] = await Promise.all([
    db.select().from(quoteSales).where(eq(quoteSales.userId, userId)).orderBy(desc(quoteSales.saleDate), desc(quoteSales.updatedAt)),
    db.select().from(quotes).where(eq(quotes.userId, userId)).orderBy(desc(quotes.issueDate), desc(quotes.updatedAt)),
    listQuoteCatalog(userId),
    getQuoteSupplier(userId),
  ])
  const saleIds = saleRows.map((row) => row.id)
  const quoteIds = quoteRows.map((row) => row.id)
  const [saleItems, storedQuoteItems, storedAttachments] = await Promise.all([
    saleIds.length ? db.select().from(quoteSaleItems).where(inArray(quoteSaleItems.saleId, saleIds)).orderBy(asc(quoteSaleItems.sortOrder)) : [],
    quoteIds.length ? db.select().from(quoteItems).where(inArray(quoteItems.quoteId, quoteIds)).orderBy(asc(quoteItems.sortOrder)) : [],
    saleIds.length ? db.select({
      id: quoteSaleAttachments.id,
      saleId: quoteSaleAttachments.saleId,
      fileName: quoteSaleAttachments.fileName,
      contentType: quoteSaleAttachments.contentType,
      fileSize: quoteSaleAttachments.fileSize,
      createdAt: quoteSaleAttachments.createdAt,
    }).from(quoteSaleAttachments).where(and(
      eq(quoteSaleAttachments.userId, userId),
      inArray(quoteSaleAttachments.saleId, saleIds),
    )).orderBy(asc(quoteSaleAttachments.createdAt), asc(quoteSaleAttachments.id)) : [],
  ])
  const saleItemsById = new Map<string, typeof saleItems>()
  for (const item of saleItems) saleItemsById.set(item.saleId, [...(saleItemsById.get(item.saleId) ?? []), item])
  const quoteItemsById = new Map<string, typeof storedQuoteItems>()
  for (const item of storedQuoteItems) quoteItemsById.set(item.quoteId, [...(quoteItemsById.get(item.quoteId) ?? []), item])
  const attachmentsBySaleId = new Map<string, QuoteWorkspaceAttachment[]>()
  for (const attachment of storedAttachments) {
    const rows = attachmentsBySaleId.get(attachment.saleId) ?? []
    rows.push(attachmentMetadata(attachment))
    attachmentsBySaleId.set(attachment.saleId, rows)
  }
  const saleClientIdByDbId = new Map(saleRows.map((row) => [row.id, row.clientId]))
  const sales = saleRows.map((row) => {
    const details = detailsRecord(row.details)
    return {
      ...details,
      id: row.clientId, saleNumber: row.saleNumber ?? '', saleDate: row.saleDate, clientName: row.customerName,
      contactName: row.contactName, status: row.status as SalesStatus,
      internalMemo: row.memo ?? String(details.internalMemo ?? ''),
      attachments: attachmentsBySaleId.get(row.id) ?? [],
      items: (saleItemsById.get(row.id) ?? []).map((item) => ({
        id: item.id, productId: item.productId, productCode: item.sku ?? '', name: item.productName,
        spec: item.optionName, qty: item.quantity, price: Number(item.unitPrice), cost: Number(item.unitCostSnapshot),
        vatIncluded: item.vatIncluded, note: item.note,
      })),
    } as QuoteWorkspaceSale
  })
  const savedQuotes = quoteRows.map((row) => {
    const details = detailsRecord(row.details)
    return {
      // Once its source sale is deleted, the foreign key is intentionally
      // cleared. Do not resurrect the stale browser-era link from JSON.
      id: row.clientId, salesId: row.saleId
        ? (saleClientIdByDbId.get(row.saleId) ?? (cleanText(details.salesId, 160) || null))
        : null,
      date: row.issueDate, recipient: row.recipient, recipientTitle: row.recipientTitle, intro: row.intro,
      supplier: normalizedSupplier(row.supplierSnapshot), notes: Array.isArray(row.notes) ? row.notes.map((note) => String(note)) : [],
      printCount: row.printCount, lastPrintedAt: row.lastPrintedAt?.toISOString() ?? null,
      items: (quoteItemsById.get(row.id) ?? []).map((item) => ({
        id: item.id, productId: item.productId, productCode: item.sku ?? '', name: item.productName,
        spec: item.optionName, qty: item.quantity, price: Number(item.unitPrice), cost: Number(item.unitCostSnapshot),
        vatIncluded: item.vatIncluded, note: item.note,
      })),
    } as QuoteWorkspaceQuote
  })
  return { sales, quotes: savedQuotes, catalog, supplier }
}
