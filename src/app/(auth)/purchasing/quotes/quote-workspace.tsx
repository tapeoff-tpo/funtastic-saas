'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Copy, Download, ExternalLink, FileSpreadsheet, LoaderCircle,
  Plus, Printer, Save, Search, Trash2,
} from 'lucide-react'
import {
  calculateQuoteLineTotals,
  calculateQuoteTotals,
  calculateSalesItemMargin,
  calculateSalesMarginTotals,
  deriveSalesStatus,
  formatKoreanWon,
  quoteItemsFromSale,
  type SalesStatus,
} from '@/lib/quotes/quote-calculations'
import styles from './quote-workspace.module.css'

type Item = {
  id: string; productId?: string | null; productCode: string; name: string; spec: string
  qty: string | number; price: string | number; cost: string | number; wholesalePrice: string | number
  vatIncluded: boolean; note: string
}
type Track = { id: string; status: 'before' | 'completed'; date: string; memo: string; amount?: string | number }
type Supplier = { reg: string; name: string; rep: string; addr: string; biz: string; type: string; tel: string; bankAccount?: string }
type SaleAttachment = { id: string; fileName: string; contentType: string; fileSize: number; createdAt: string }
type Sale = {
  id: string; customerId: string | null; saleNumber: string; saleDate: string; quoteDate: string; clientName: string
  representativeName: string; contactName: string; contactPhone: string; businessRegistrationNumber: string
  taxInvoiceEmail: string; address: string; recipientName: string; recipientPhone: string
  deliveryMessage: string; recipientTitle: string; requestedDueDate: string; status: SalesStatus
  includeShipping: boolean; shippingFee: string | number; shippingCost: string | number
  shippingVatIncluded: boolean; internalMemo: string; attachments: SaleAttachment[]
  items: Item[]; shipments: Track[]; payments: Track[]
}
type Quote = {
  id: string; customerId: string | null; salesId: string | null; date: string; recipient: string; recipientTitle: string
  intro: string; supplier: Supplier; notes: string[]; items: Item[]; printCount?: number; lastPrintedAt?: string | null
}
type Catalog = { id: string; sku: string; name: string; spec: string; cost: number | null; location: string }
type Client = {
  id: string; clientName: string; representativeName: string; contactName: string; contactPhone: string
  businessRegistrationNumber: string; taxInvoiceEmail: string; address: string; recipientName: string
  recipientPhone: string; recipientTitle: string; deliveryMessage: string; memo: string
}
type Workspace = { sales: Sale[]; quotes: Quote[]; catalog: Catalog[]; supplier: Supplier; clients?: Client[] }
type Tab = 'sales' | 'quote'
type ExportScope = 'all' | 'selected' | 'date'
type MonthlySummary = { month: string; count: number; activeCount: number; totalGross: number }

const salesHistoryKey = 'funtastic-sales-history'
const quoteHistoryKey = 'funtastic-quote-history'
const migrationKey = 'funtastic-quote-server-history-imported'
const statusNames: Record<SalesStatus, string> = { pending: '진행 전', inProgress: '진행 중', blocked: '진행 불가', completed: '전체 완료' }
const dateToday = () => new Date().toISOString().slice(0, 10)
const id = (prefix: string) => prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
const value = (input: unknown) => Number.isFinite(Number(input)) ? Math.max(0, Number(input)) : 0
const money = (input: number | null | undefined) => input == null ? '—' : '₩ ' + Math.round(input).toLocaleString('ko-KR')
const percent = (input: number | null | undefined) => input == null ? '—' : (input * 100).toFixed(1) + '%'
const emptySupplier = (): Supplier => ({ reg: '', name: '', rep: '', addr: '', biz: '', type: '', tel: '', bankAccount: '' })
const attachmentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const attachmentSize = (bytes: number) => bytes < 1024 ? `${bytes}B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)}KB` : `${(bytes / (1024 * 1024)).toFixed(1)}MB`

function quoteDateOf(sale: Pick<Sale, 'quoteDate' | 'saleDate'>) {
  const candidate = String(sale.quoteDate || sale.saleDate || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : ''
}
function copySaleRecord(source: Sale): Sale {
  return normalizeSale({
    ...source,
    id: id('sale'),
    saleNumber: '',
    saleDate: dateToday(),
    quoteDate: dateToday(),
    attachments: [],
    items: source.items.map((item) => newItem({ ...item, id: id('item') })),
    shipments: source.shipments.map((row) => newTrack({ ...row, id: id('track') })),
    payments: source.payments.map((row) => newTrack({ ...row, id: id('track') })),
  })
}
function importedDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000).toISOString().slice(0, 10)
  }
  const text = String(value ?? '').trim()
  const parts = text.match(/(\d{4})[./-]?(\d{1,2})[./-]?(\d{1,2})/)
  if (!parts) return ''
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
  if (date.getUTCFullYear() !== Number(parts[1]) || date.getUTCMonth() !== Number(parts[2]) - 1 || date.getUTCDate() !== Number(parts[3])) return ''
  return date.toISOString().slice(0, 10)
}
function headerKey(value: unknown) { return String(value ?? '').replace(/\s+/g, '').trim() }
function importedNumber(value: unknown) {
  const text = String(value ?? '').replace(/[₩￦원\s,，]/g, '').trim()
  if (!text) return null
  const number = Number(text)
  return Number.isFinite(number) && number >= 0 ? number : null
}
function importedTrackingRows(values: string[]): Track[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (!unique.length) return [newTrack()]
  return unique.map((memo) => {
    const waiting = /대기|미입금|미출고|진행전|\b전\b/.test(memo)
    const completed = /완료|입금|출고|배송|결제/.test(memo)
    return newTrack({ status: !waiting && completed ? 'completed' : 'before', date: importedDate(memo), memo })
  })
}
function importSalesFromWorkbook(file: File): Promise<Sale[]> {
  return Promise.all([file.arrayBuffer(), import('xlsx')]).then(([buffer, XLSX]) => {
    const book = XLSX.read(buffer, { type: 'array', cellDates: true })
    for (const sheetName of book.SheetNames) {
      const sheet = book.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
      const headerRow = rows.findIndex((row) => {
        const headings = row.map(headerKey)
        return headings.some((heading) => ['견적일', '날짜'].includes(heading))
          && headings.some((heading) => ['거래처', '거래처명', '업체명', '입금자'].includes(heading))
          && headings.some((heading) => ['품목명', '상품명', '제품명', '품명'].includes(heading))
      })
      if (headerRow < 0) continue
      const headings = rows[headerRow].map(headerKey)
      const indexOf = (...aliases: string[]) => headings.findIndex((heading) => aliases.includes(heading))
      const columns = {
        date: indexOf('견적일', '날짜'), client: indexOf('거래처', '거래처명', '업체명', '입금자'),
        status: indexOf('영업상태', '상태'), code: indexOf('품목코드', '상품코드', '품번코드'),
        name: indexOf('품목명', '상품명', '제품명', '품명'), spec: indexOf('옵션', '옵션명', '규격'),
        qty: indexOf('수량', '구매수량'), price: indexOf('단가', '개당판매가', '견적단가', '공급가'),
        cost: indexOf('원가'), wholesalePrice: indexOf('도매가'), note: indexOf('비고'),
        shipment: indexOf('배송', '출고'), payment: indexOf('입금'),
        shippingCost: indexOf('(-)배송비', '실배송비', '부담배송비'), shippingFee: indexOf('(+)배송비', '받는배송비'),
      }
      if (columns.date < 0 || columns.client < 0 || columns.name < 0 || columns.qty < 0 || columns.price < 0) continue
      const groups = new Map<string, {
        date: string; client: string; status: SalesStatus; items: Item[]; shipments: string[]; payments: string[]
        shippingFee: number | null; shippingCost: number | null
      }>()
      for (const row of rows.slice(headerRow + 1)) {
        const date = importedDate(row[columns.date])
        const client = String(row[columns.client] ?? '').trim()
        const name = String(row[columns.name] ?? '').trim()
        if (!date || !client || !name) continue
        const statusLabel = columns.status >= 0 ? String(row[columns.status] ?? '') : ''
        const status: SalesStatus = /완료/.test(statusLabel) ? 'completed' : /불가|중단/.test(statusLabel) ? 'blocked' : /진행/.test(statusLabel) ? 'inProgress' : 'pending'
        const key = `${date}\u0000${client}\u0000${status}`
        const group = groups.get(key) ?? { date, client, status, items: [], shipments: [], payments: [], shippingFee: null, shippingCost: null }
        group.items.push(newItem({
          productCode: columns.code >= 0 ? String(row[columns.code] ?? '').trim() : '',
          name,
          spec: columns.spec >= 0 ? String(row[columns.spec] ?? '').trim() : '',
          qty: value(row[columns.qty]), price: value(row[columns.price]), cost: columns.cost >= 0 ? value(row[columns.cost]) : 0,
          wholesalePrice: columns.wholesalePrice >= 0 ? value(row[columns.wholesalePrice]) : 0,
          note: columns.note >= 0 ? String(row[columns.note] ?? '').trim() : '',
        }))
        const shipment = columns.shipment >= 0 ? String(row[columns.shipment] ?? '').trim() : ''
        const payment = columns.payment >= 0 ? String(row[columns.payment] ?? '').trim() : ''
        if (shipment) group.shipments.push(shipment)
        if (payment) group.payments.push(payment)
        const shippingFee = columns.shippingFee >= 0 ? importedNumber(row[columns.shippingFee]) : null
        const shippingCost = columns.shippingCost >= 0 ? importedNumber(row[columns.shippingCost]) : null
        if (group.shippingFee === null && shippingFee !== null) group.shippingFee = shippingFee
        if (group.shippingCost === null && shippingCost !== null) group.shippingCost = shippingCost
        groups.set(key, group)
      }
      if (groups.size) return [...groups.values()].map((group) => {
        const shipments = importedTrackingRows(group.shipments)
        const payments = importedTrackingRows(group.payments)
        const hasTracking = group.shipments.length > 0 || group.payments.length > 0
        return normalizeSale({
          id: id('sale'), saleDate: group.date, quoteDate: group.date, clientName: group.client,
          status: group.status === 'blocked' ? 'blocked' : (hasTracking ? deriveSalesStatus(shipments, payments) : group.status),
          includeShipping: (group.shippingFee ?? 0) > 0, shippingFee: group.shippingFee ?? 0, shippingCost: group.shippingCost ?? 0,
          items: group.items, shipments, payments,
        })
      })
    }
    throw new Error('날짜·거래처·품목명·수량·단가 열을 찾지 못했습니다.')
  })
}
function saleImportSignature(sale: Sale) {
  return JSON.stringify([
    quoteDateOf(sale), sale.clientName.trim(),
    ...sale.items.map((item) => [item.productCode.trim(), item.name.trim(), item.spec.trim(), value(item.qty), value(item.price)]),
  ])
}

function newItem(partial: Partial<Item> = {}): Item {
  return { id: id('item'), productId: null, productCode: '', name: '', spec: '', qty: 1, price: 0, cost: 0, wholesalePrice: 0, vatIncluded: false, note: '', ...partial }
}
function newTrack(partial: Partial<Track> = {}): Track {
  return { id: id('track'), status: 'before', date: '', memo: '', ...partial }
}
function newSale(): Sale {
  return {
    id: id('sale'), customerId: null, saleNumber: '', saleDate: dateToday(), quoteDate: dateToday(), clientName: '',
    representativeName: '', contactName: '', contactPhone: '', businessRegistrationNumber: '',
    taxInvoiceEmail: '', address: '', recipientName: '', recipientPhone: '', deliveryMessage: '',
    recipientTitle: '대표이사 귀하', requestedDueDate: '', status: 'pending', includeShipping: false,
    shippingFee: 0, shippingCost: 0, shippingVatIncluded: true, internalMemo: '', attachments: [],
    items: [newItem()], shipments: [newTrack()], payments: [newTrack()],
  }
}
function newClient(): Client {
  return {
    id: '', clientName: '', representativeName: '', contactName: '', contactPhone: '',
    businessRegistrationNumber: '', taxInvoiceEmail: '', address: '', recipientName: '', recipientPhone: '', recipientTitle: '',
    deliveryMessage: '', memo: '',
  }
}
function quoteNotes(date = dateToday(), supplier: Supplier = emptySupplier()) {
  const parsed = new Date(date + 'T00:00:00')
  const account = supplier.bankAccount?.trim()
  return [
    '본 견적서는 ' + parsed.getFullYear() + '년 ' + (parsed.getMonth() + 1) + '월 ' + parsed.getDate() + '일에 진행된 발주에 대한 견적서입니다.',
    '본 견적서의 납기일정은 약 2-3주 정도 소요 됩니다.',
    account ? `${supplier.name?.trim() || '공급자'} 입금계좌: ${account}` : '',
    '배송은 택배를 통해 발송되며, 택배사는 대한통운입니다.',
    '본 견적서는 발행일로부터 30일동안 유효합니다.',
    '대량건은 단순변심으로 환불이 어려우며, 불량품에 한하여 7일 이내 교환 및 환불 가능합니다.',
  ].filter(Boolean)
}
function newQuote(supplier: Supplier, sale?: Sale): Quote {
  const date = sale?.quoteDate || dateToday()
  return {
    id: id('quote'), customerId: sale?.customerId || null, salesId: sale?.id || null, date, recipient: sale?.clientName || '',
    recipientTitle: sale?.recipientTitle || '대표이사 귀하', intro: '아래와 같이 납품 및 청구합니다.',
    supplier: { ...supplier }, notes: quoteNotes(date, supplier),
    items: sale ? quoteItemsForSale(sale) : [newItem()],
  }
}
function normalizeItem(input: Partial<Item> | undefined): Item {
  return newItem({ ...input, id: String(input?.id || id('item')), productCode: String(input?.productCode || ''), name: String(input?.name || ''), spec: String(input?.spec || ''), note: String(input?.note || '') })
}
function normalizeTrack(input: Partial<Track> | undefined): Track {
  return newTrack({ ...input, id: String(input?.id || id('track')), status: input?.status === 'completed' ? 'completed' : 'before', date: String(input?.date || ''), memo: String(input?.memo || '') })
}
function normalizeAttachment(input: unknown): SaleAttachment | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const source = input as Partial<SaleAttachment>
  const attachmentId = String(source.id || '').trim()
  const fileName = String(source.fileName || '').trim()
  if (!attachmentIdPattern.test(attachmentId) || !fileName) return null
  return {
    id: attachmentId,
    fileName,
    contentType: String(source.contentType || 'application/octet-stream').slice(0, 160),
    fileSize: Math.max(0, Math.floor(value(source.fileSize))),
    createdAt: String(source.createdAt || ''),
  }
}
function normalizeSale(input: Partial<Sale> | undefined): Sale {
  const base = newSale()
  return {
    ...base, ...input, id: String(input?.id || id('sale')), customerId: input?.customerId ? String(input.customerId) : null, saleNumber: String(input?.saleNumber || ''),
    saleDate: String(input?.saleDate || dateToday()), quoteDate: String(input?.quoteDate || input?.saleDate || dateToday()),
    clientName: String(input?.clientName || ''), representativeName: String(input?.representativeName || ''),
    contactName: String(input?.contactName || ''), contactPhone: String(input?.contactPhone || ''),
    businessRegistrationNumber: String(input?.businessRegistrationNumber || ''), taxInvoiceEmail: String(input?.taxInvoiceEmail || ''),
    address: String(input?.address || ''), recipientName: String(input?.recipientName || ''), recipientPhone: String(input?.recipientPhone || ''),
    deliveryMessage: String(input?.deliveryMessage || ''), recipientTitle: String(input?.recipientTitle || '대표이사 귀하'),
    requestedDueDate: String(input?.requestedDueDate || ''), status: input?.status === 'inProgress' || input?.status === 'blocked' || input?.status === 'completed' ? input.status : 'pending',
    attachments: Array.isArray(input?.attachments) ? input.attachments.map(normalizeAttachment).filter((attachment): attachment is SaleAttachment => attachment !== null) : [],
    items: (input?.items?.length ? input.items : base.items).map(normalizeItem),
    shipments: (input?.shipments?.length ? input.shipments : base.shipments).map(normalizeTrack),
    payments: (input?.payments?.length ? input.payments : base.payments).map(normalizeTrack),
  }
}
function normalizeClient(input: Partial<Client> | undefined): Client {
  const base = newClient()
  return {
    ...base,
    ...input,
    id: String(input?.id || ''),
    clientName: String(input?.clientName || ''),
    representativeName: String(input?.representativeName || ''),
    contactName: String(input?.contactName || ''),
    contactPhone: String(input?.contactPhone || ''),
    businessRegistrationNumber: String(input?.businessRegistrationNumber || ''),
    taxInvoiceEmail: String(input?.taxInvoiceEmail || ''),
    address: String(input?.address || ''),
    recipientName: String(input?.recipientName || ''),
    recipientPhone: String(input?.recipientPhone || ''),
    recipientTitle: String(input?.recipientTitle || ''),
    deliveryMessage: String(input?.deliveryMessage || ''),
    memo: String(input?.memo || ''),
  }
}
function saleFromClient(sale: Sale, client: Client): Sale {
  return {
    ...sale,
    customerId: client.id || null,
    clientName: client.clientName,
    representativeName: client.representativeName,
    contactName: client.contactName,
    contactPhone: client.contactPhone,
    businessRegistrationNumber: client.businessRegistrationNumber,
    taxInvoiceEmail: client.taxInvoiceEmail,
    address: client.address,
    recipientName: client.recipientName || client.contactName,
    recipientPhone: client.recipientPhone || client.contactPhone,
    recipientTitle: client.recipientTitle || sale.recipientTitle,
    deliveryMessage: client.deliveryMessage,
  }
}
function quoteFromClient(quote: Quote, client: Client): Quote {
  return {
    ...quote,
    customerId: client.id || null,
    recipient: client.clientName,
    recipientTitle: client.recipientTitle || quote.recipientTitle,
  }
}
function normalizeQuote(input: Partial<Quote> | undefined, supplier: Supplier): Quote {
  const base = newQuote(supplier)
  return {
    ...base, ...input, id: String(input?.id || id('quote')), customerId: input?.customerId ? String(input.customerId) : null, salesId: input?.salesId ? String(input.salesId) : null,
    date: String(input?.date || dateToday()), recipient: String(input?.recipient || ''),
    recipientTitle: String(input?.recipientTitle || '대표이사 귀하'), intro: String(input?.intro || base.intro),
    supplier: { ...supplier, ...(input?.supplier || {}) },
    notes: Array.isArray(input?.notes) && input.notes.length ? input.notes.map(String) : base.notes,
    items: (input?.items?.length ? input.items : base.items).map(normalizeItem),
  }
}
async function api<T>(method: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/purchasing/quotes', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.')
  return data as T
}
async function attachmentApi<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '첨부파일을 처리하지 못했습니다.')
  return data as T
}
function catalogItem(item: Item, catalog: Catalog[], code: string): Item {
  const found = catalog.find((entry) => entry.sku === code || entry.name === code)
  return found ? { ...item, productId: found.id, productCode: found.sku, name: found.name, spec: found.spec || item.spec, cost: found.cost == null ? item.cost : found.cost } : { ...item, productCode: code }
}
function titleOf(quote: Quote) {
  const item = quote.items.find((entry) => entry.name)?.name || '품목 미입력'
  return (quote.recipient || '거래처 미입력') + ' / ' + quote.date + ' / ' + item
}

function quoteItemsForSale(sale: Sale): Item[] {
  const sourceItems = sale.items.filter((item) => item.name.trim())
  return quoteItemsFromSale(sale).map((line, index) => {
    const source = sourceItems[index]
    if (source) {
      return newItem({
        ...source,
        ...line,
        id: id('item'),
        productId: source.productId ?? null,
        productCode: source.productCode,
        qty: line.qty ?? 0,
        price: line.price ?? 0,
        vatIncluded: Boolean(line.vatIncluded),
        cost: source.cost,
        wholesalePrice: source.wholesalePrice,
      })
    }
    // The final customer-facing line is the separately charged shipping fee.
    // Keep its actual delivery cost in the internal snapshot, never on print.
    return newItem({ ...line, id: id('item'), qty: line.qty ?? 0, price: line.price ?? 0, vatIncluded: Boolean(line.vatIncluded), cost: sale.shippingCost, wholesalePrice: 0 })
  })
}

function saleQuoteValidationError(sale: Sale): string | null {
  if (!sale.clientName.trim()) return '견적서를 만들려면 거래처명을 입력해주세요.'
  const invalidItem = !sale.items.length || sale.items.some((item) => (
    !item.name.trim()
    || item.qty === '' || item.qty == null || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0
    || item.price === '' || item.price == null || !Number.isFinite(Number(item.price)) || Number(item.price) < 0
  ))
  if (invalidItem) return '견적서를 만들려면 모든 품목의 품명, 수량, 공급가를 입력하거나 빈 품목을 삭제해주세요.'
  if (sale.includeShipping && (sale.shippingFee === '' || sale.shippingFee == null || !Number.isFinite(Number(sale.shippingFee)) || Number(sale.shippingFee) < 0)) {
    return '견적서에 반영할 받는 배송비를 입력해주세요. 배송비가 없으면 0을 입력하세요.'
  }
  return null
}

function quoteItemsMatch(left: Item[], right: Item[]) {
  const normalize = (items: Item[]) => items.map((item) => [
    item.name, item.spec, String(item.qty ?? ''), String(item.price ?? ''), Boolean(item.vatIncluded), item.note,
  ])
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

export default function QuoteWorkspace() {
  const [tab, setTab] = useState<Tab>('sales')
  const [sales, setSales] = useState<Sale[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [catalog, setCatalog] = useState<Catalog[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [supplier, setSupplier] = useState<Supplier>(emptySupplier)
  const [sale, setSale] = useState<Sale | null>(null)
  const [quote, setQuote] = useState<Quote>(() => newQuote(emptySupplier()))
  const [selectedQuote, setSelectedQuote] = useState('')
  const [selectedSales, setSelectedSales] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | SalesStatus>('all')
  const [quoteYear, setQuoteYear] = useState(() => dateToday().slice(0, 4))
  const [quoteMonth, setQuoteMonth] = useState(() => dateToday().slice(5, 7))
  const [allPeriods, setAllPeriods] = useState(false)
  const [monthlyOpen, setMonthlyOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [legacy, setLegacy] = useState<{ sales: Sale[]; quotes: Quote[] } | null>(null)
  const salesImportRef = useRef<HTMLInputElement>(null)
  const listSaveQueueRef = useRef(new Map<string, Promise<void>>())
  const initializedQuoteRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<Workspace>('GET')
      const currentSupplier = { ...emptySupplier(), ...(result.supplier || {}) }
      setSupplier(currentSupplier)
      setSales((result.sales || []).map(normalizeSale))
      setQuotes((result.quotes || []).map((item) => normalizeQuote(item, currentSupplier)))
      setCatalog(result.catalog || [])
      setClients((result.clients || []).map(normalizeClient))
      // The initial blank document is created before the shared company
      // settings arrive. Replace it once so its supplier/account-note
      // snapshot uses the common company data, but never wipe an already
      // edited document during a later catalog refresh.
      setQuote((current) => {
        if (initializedQuoteRef.current) return normalizeQuote(current, currentSupplier)
        initializedQuoteRef.current = true
        return newQuote(currentSupplier)
      })
      try {
        if (!window.localStorage.getItem(migrationKey)) {
          const oldSales = JSON.parse(window.localStorage.getItem(salesHistoryKey) || '[]')
          const oldQuotes = JSON.parse(window.localStorage.getItem(quoteHistoryKey) || '[]')
          const savedSales = Array.isArray(oldSales) ? oldSales.map(normalizeSale) : []
          const savedQuotes = Array.isArray(oldQuotes) ? oldQuotes.map((item) => normalizeQuote(item, currentSupplier)) : []
          if (savedSales.length || savedQuotes.length) setLegacy({ sales: savedSales, quotes: savedQuotes })
        }
      } catch { /* Existing local history is optional. */ }
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '공용 데이터를 불러오지 못했습니다.', error: true })
    } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const matchingSales = useMemo(() => sales.filter((entry) => {
    if (status !== 'all' && entry.status !== status) return false
    const term = search.trim().toLowerCase()
    return !term || [
      entry.clientName, entry.representativeName, entry.contactName, entry.contactPhone, entry.saleNumber,
      entry.businessRegistrationNumber, entry.taxInvoiceEmail, entry.address,
      ...entry.items.flatMap((item) => [item.name, item.productCode, item.spec]),
    ].join(' ').toLowerCase().includes(term)
  }), [sales, status, search])
  const shownSales = useMemo(() => matchingSales
    .filter((entry) => allPeriods || quoteDateOf(entry).startsWith(`${quoteYear}-${quoteMonth}`))
    .slice()
    .sort((left, right) => quoteDateOf(right).localeCompare(quoteDateOf(left))), [allPeriods, matchingSales, quoteMonth, quoteYear])
  const quoteYears = useMemo(() => [...new Set([dateToday().slice(0, 4), ...sales.map((entry) => quoteDateOf(entry).slice(0, 4)).filter(Boolean)])].sort((left, right) => right.localeCompare(left)), [sales])
  const monthlySummary = useMemo<MonthlySummary[]>(() => Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0')
    const rows = matchingSales.filter((entry) => quoteDateOf(entry).startsWith(`${quoteYear}-${month}`))
    const activeRows = rows.filter((entry) => entry.status === 'inProgress' || entry.status === 'completed')
    return {
      month,
      count: rows.length,
      activeCount: activeRows.length,
      totalGross: activeRows.reduce((sum, entry) => sum + (calculateSalesMarginTotals({
        items: entry.items.map((item) => ({ qty: item.qty, price: item.price, cost: item.cost, wholesalePrice: item.wholesalePrice, vatIncluded: item.vatIncluded })),
        includeShipping: entry.includeShipping, shippingFee: entry.shippingFee, shippingCost: entry.shippingCost, shippingVatIncluded: entry.shippingVatIncluded,
      }).totalGross ?? 0), 0),
    }
  }), [matchingSales, quoteYear])
  const currentSaleTotals = useMemo(() => sale ? calculateSalesMarginTotals({
    items: sale.items.map((item) => ({ qty: item.qty, price: item.price, cost: item.cost, wholesalePrice: item.wholesalePrice, vatIncluded: item.vatIncluded })),
    includeShipping: sale.includeShipping, shippingFee: sale.shippingFee, shippingCost: sale.shippingCost, shippingVatIncluded: sale.shippingVatIncluded,
  }) : null, [sale])
  const currentQuoteTotals = useMemo(() => calculateQuoteTotals(quote.items), [quote.items])

  const saveSale = async () => {
    if (!sale) return
    setSaving(true)
    try {
      const result = await api<{ sale: Sale }>('POST', { action: 'save-sale', sale })
      const saved = normalizeSale(result.sale)
      setSales((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)])
      setSale(saved)
      setNotice({ text: '영업건을 공용 데이터에 저장했습니다.' })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : '영업건 저장에 실패했습니다.', error: true }) } finally { setSaving(false) }
  }
  const updateSaleFromList = (saleId: string, updater: (current: Sale) => Sale) => {
    const current = sales.find((entry) => entry.id === saleId)
    if (!current) return
    const next = normalizeSale(updater(current))
    setSales((rows) => rows.map((entry) => entry.id === saleId ? next : entry))
    const previous = listSaveQueueRef.current.get(saleId) ?? Promise.resolve()
    const queued = previous.catch(() => undefined).then(async () => {
      const result = await api<{ sale: Sale }>('POST', { action: 'save-sale', sale: next })
      const saved = normalizeSale(result.sale)
      setSales((rows) => rows.map((entry) => entry.id === saleId ? saved : entry))
    }).catch((error) => {
      setNotice({ text: error instanceof Error ? error.message : '영업 현황을 바로 저장하지 못했습니다.', error: true })
    })
    listSaveQueueRef.current.set(saleId, queued)
    void queued.finally(() => {
      if (listSaveQueueRef.current.get(saleId) === queued) listSaveQueueRef.current.delete(saleId)
    })
  }
  const removeSale = async (saleId: string) => {
    if (!window.confirm('이 영업건을 삭제할까요?')) return
    try {
      await api('DELETE', { target: 'sale', id: saleId })
      setSales((current) => current.filter((entry) => entry.id !== saleId))
      setSelectedSales((current) => current.filter((entry) => entry !== saleId))
      if (sale?.id === saleId) setSale(null)
      setNotice({ text: '영업건을 삭제했습니다.' })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : '삭제에 실패했습니다.', error: true }) }
  }
  const saveQuote = async () => {
    setSaving(true)
    try {
      const result = await api<{ quote: Quote }>('POST', { action: 'save-quote', quote })
      const saved = normalizeQuote(result.quote, supplier)
      setQuotes((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)])
      setQuote(saved); setSelectedQuote(saved.id); setNotice({ text: '견적서를 공용 데이터에 저장했습니다.' })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : '견적서 저장에 실패했습니다.', error: true }) } finally { setSaving(false) }
  }
  const removeQuote = async () => {
    if (!quote.id || !window.confirm('이 견적서를 삭제할까요?')) return
    try {
      await api('DELETE', { target: 'quote', id: quote.id })
      setQuotes((current) => current.filter((entry) => entry.id !== quote.id))
      setQuote(newQuote(supplier)); setSelectedQuote(''); setNotice({ text: '견적서를 삭제했습니다.' })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : '삭제에 실패했습니다.', error: true }) }
  }
  const importLegacy = async () => {
    if (!legacy) return
    setSaving(true)
    try {
      const result = await api<Workspace>('POST', { action: 'migrate-browser-history', sales: legacy.sales, quotes: legacy.quotes })
      const currentSupplier = { ...supplier, ...(result.supplier || {}) }
      setSales((result.sales || []).map(normalizeSale))
      setQuotes((result.quotes || []).map((entry) => normalizeQuote(entry, currentSupplier)))
      setCatalog(result.catalog || [])
      setClients((result.clients || []).map(normalizeClient))
      window.localStorage.setItem(migrationKey, 'true'); setLegacy(null)
      setNotice({ text: '이 브라우저의 기존 기록을 공용 데이터로 가져왔습니다.' })
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : '기존 기록을 가져오지 못했습니다.', error: true }) } finally { setSaving(false) }
  }
  const exportSales = async (scope: ExportScope = 'selected', exportDate = '') => {
    const source = scope === 'all'
      ? sales
      : scope === 'date'
        ? sales.filter((entry) => quoteDateOf(entry) === exportDate)
        : sales.filter((entry) => selectedSales.includes(entry.id))
    const rows = source.flatMap((entry) => entry.items.map((item) => {
      const margin = calculateSalesItemMargin({ qty: item.qty, price: item.price, cost: item.cost, wholesalePrice: item.wholesalePrice, vatIncluded: item.vatIncluded })
      return { 견적일: entry.quoteDate, 영업상태: statusNames[entry.status], 거래처: entry.clientName, 품목코드: item.productCode, 품목명: item.name, 옵션: item.spec, 수량: value(item.qty), 단가: value(item.price), 원가: value(item.cost), 매출: margin.totalGross || '', 순이익: margin.totalProfit || '', 순이익률: margin.totalProfitRate || '' }
    }))
    if (!rows.length) {
      setNotice({ text: scope === 'date' ? '선택한 견적일에 다운로드할 품목이 없습니다.' : '다운로드할 품목이 없습니다.', error: true })
      return
    }
    setSaving(true)
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), '영업관리')
      const prefix = scope === 'all' ? '전체영업목록' : scope === 'date' ? `견적일_${exportDate.replaceAll('-', '')}_영업목록` : '선택영업목록'
      XLSX.writeFile(book, `${prefix}_${dateToday().replaceAll('-', '')}.xlsx`)
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '영업목록 엑셀을 만들지 못했습니다.', error: true })
    } finally { setSaving(false) }
  }
  const deleteSelectedSales = async () => {
    const ids = selectedSales.filter((saleId) => sales.some((entry) => entry.id === saleId))
    if (!ids.length) return
    if (!window.confirm(`선택한 영업건 ${ids.length.toLocaleString('ko-KR')}건을 삭제할까요?\n\n연결된 견적서는 유지됩니다.`)) return
    setSaving(true)
    try {
      await Promise.all(ids.map((saleId) => api('DELETE', { target: 'sale', id: saleId })))
      const deleted = new Set(ids)
      setSales((current) => current.filter((entry) => !deleted.has(entry.id)))
      setSelectedSales([])
      setNotice({ text: `영업건 ${ids.length.toLocaleString('ko-KR')}건을 삭제했습니다.` })
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '선택 영업건 삭제에 실패했습니다.', error: true })
    } finally { setSaving(false) }
  }
  const copySelectedSale = () => {
    if (selectedSales.length !== 1) return
    const source = sales.find((entry) => entry.id === selectedSales[0])
    if (!source) return
    setSelectedSales([])
    setSale(copySaleRecord(source))
  }
  const importSales = async (file: File) => {
    setSaving(true)
    try {
      const imported = await importSalesFromWorkbook(file)
      const signatures = new Set(sales.map(saleImportSignature))
      const additions = imported.filter((entry) => {
        const signature = saleImportSignature(entry)
        if (signatures.has(signature)) return false
        signatures.add(signature)
        return true
      })
      if (!additions.length) {
        setNotice({ text: '가져올 수 있는 새 영업건이 없습니다. 중복된 기록은 건너뛰었습니다.' })
        return
      }
      let result: Workspace | null = null
      for (let offset = 0; offset < additions.length; offset += 500) {
        result = await api<Workspace>('POST', { action: 'migrate-browser-history', sales: additions.slice(offset, offset + 500), quotes: [] })
      }
      if (result) {
        const currentSupplier = { ...supplier, ...(result.supplier || {}) }
        setSales((result.sales || []).map(normalizeSale))
        setQuotes((result.quotes || []).map((entry) => normalizeQuote(entry, currentSupplier)))
        setCatalog(result.catalog || [])
        setClients((result.clients || []).map(normalizeClient))
      }
      setSelectedSales([])
      setNotice({ text: `${additions.length.toLocaleString('ko-KR')}건의 영업 기록을 공용 데이터에 추가했습니다.` })
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '엑셀 영업건을 가져오지 못했습니다.', error: true })
    } finally { setSaving(false) }
  }
  const applyCatalogItem = (itemId: string, code: string, target: 'sale' | 'quote') => {
    if (target === 'sale' && sale) setSale({ ...sale, items: sale.items.map((item) => item.id === itemId ? catalogItem(item, catalog, code) : item) })
    if (target === 'quote') setQuote({ ...quote, items: quote.items.map((item) => item.id === itemId ? catalogItem(item, catalog, code) : item) })
  }
  const openQuoteForSale = (source: Sale) => {
    const validationError = saleQuoteValidationError(source)
    if (validationError) {
      setNotice({ text: validationError, error: true })
      return
    }
    const saleItems = quoteItemsForSale(source)
    const existing = quotes.find((entry) => entry.salesId === source.id)
    if (existing) {
      const loaded = normalizeQuote(existing, supplier)
      const differs = !quoteItemsMatch(loaded.items, saleItems)
        || loaded.recipient !== source.clientName
        || loaded.recipientTitle !== (source.recipientTitle || '대표이사 귀하')
        || loaded.date !== (source.quoteDate || dateToday())
      const shouldRefresh = differs && window.confirm('저장된 견적서와 현재 영업건의 거래처, 견적일 또는 품목이 다릅니다.\n\n확인: 현재 영업건 내용으로 견적서에 다시 반영\n취소: 저장된 견적서 그대로 열기\n\n변경한 견적서는 저장 버튼을 눌러야 저장됩니다.')
      setQuote(shouldRefresh ? {
        ...loaded,
        salesId: source.id,
        customerId: source.customerId,
        date: source.quoteDate || dateToday(),
        recipient: source.clientName,
        recipientTitle: source.recipientTitle || '대표이사 귀하',
        items: saleItems,
      } : loaded)
      setSelectedQuote(existing.id)
    } else {
      setQuote(newQuote(supplier, source))
      setSelectedQuote('')
    }
    setTab('quote')
  }
  const uploadSaleAttachments = async (files: FileList | null) => {
    if (!sale || !files?.length) return
    if (!sales.some((entry) => entry.id === sale.id)) {
      setNotice({ text: '영업건을 먼저 저장한 후 첨부파일을 추가해주세요.', error: true })
      return
    }
    setSaving(true)
    const uploaded: SaleAttachment[] = []
    const failures: string[] = []
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.set('saleId', sale.id)
        formData.set('file', file)
        try {
          const result = await attachmentApi<{ attachment: SaleAttachment }>('/api/purchasing/quotes/attachments', {
            method: 'POST',
            body: formData,
          })
          uploaded.push(result.attachment)
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : '업로드 실패'}`)
        }
      }
      if (uploaded.length) {
        const append = (current: Sale) => ({ ...current, attachments: [...current.attachments, ...uploaded] })
        setSale((current) => current?.id === sale.id ? append(current) : current)
        setSales((current) => current.map((entry) => entry.id === sale.id ? append(entry) : entry))
      }
      if (failures.length) {
        setNotice({ text: uploaded.length ? `${uploaded.length}개 파일을 첨부했습니다. ${failures[0]}` : failures[0], error: true })
      } else {
        setNotice({ text: `${uploaded.length}개 파일을 첨부했습니다.` })
      }
    } finally { setSaving(false) }
  }
  const removeSaleAttachment = async (attachment: SaleAttachment) => {
    if (!sale || !window.confirm(`${attachment.fileName} 파일을 삭제할까요?`)) return
    setSaving(true)
    try {
      await attachmentApi(`/api/purchasing/quotes/attachments/${attachment.id}?saleId=${encodeURIComponent(sale.id)}`, { method: 'DELETE' })
      const omit = (current: Sale) => ({ ...current, attachments: current.attachments.filter((entry) => entry.id !== attachment.id) })
      setSale((current) => current?.id === sale.id ? omit(current) : current)
      setSales((current) => current.map((entry) => entry.id === sale.id ? omit(entry) : entry))
      setNotice({ text: '첨부파일을 삭제했습니다.' })
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '첨부파일을 삭제하지 못했습니다.', error: true })
    } finally { setSaving(false) }
  }
  const downloadSaleAttachment = (attachment: SaleAttachment) => {
    if (!sale) return
    const link = document.createElement('a')
    link.href = `/api/purchasing/quotes/attachments/${attachment.id}?saleId=${encodeURIComponent(sale.id)}`
    link.download = attachment.fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
  }
  const downloadSabangnet = async () => {
    if (!sale) return
    setSaving(true)
    try {
      const { createSabangnetWorkbook, sabangnetFilename, sabangnetValidationIssues, sabangnetWorkbookMimeType } = await import('@/lib/quotes/sabangnet-export')
      const issues = sabangnetValidationIssues(sale)
      if (issues.length) {
        setNotice({ text: `사방넷 엑셀을 만들려면 ${issues.join(', ')}을(를) 입력해 주세요.`, error: true })
        return
      }
      const blob = new Blob([createSabangnetWorkbook(sale)], { type: sabangnetWorkbookMimeType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = sabangnetFilename(sale)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setNotice({ text: '사방넷 등록 엑셀을 다운로드했습니다.' })
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : '사방넷 엑셀을 만들지 못했습니다.', error: true })
    } finally { setSaving(false) }
  }

  return <div className={styles.workspace}>
    <header className={[styles.topbar, styles.noPrint].join(' ')}>
      <strong>펀타 영업·견적</strong>
      <nav className={styles.tabs} aria-label="견적서 탭">
        <button type="button" className={tab === 'sales' ? styles.tabActive : styles.tab} onClick={() => { setTab('sales'); setSale(null) }}>영업관리</button>
        <button type="button" className={tab === 'quote' ? styles.tabActive : styles.tab} onClick={() => setTab('quote')}>견적서</button>
      </nav>
      <button type="button" className={styles.primary} onClick={() => { const next = newSale(); setSale(next); setTab('sales') }}><Plus size={15} /> 새 영업건</button>
    </header>
    {notice ? <div className={[styles.notice, notice.error ? styles.noticeError : styles.noticeSuccess].join(' ')}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)}>닫기</button></div> : null}
    {legacy ? <div className={[styles.legacy, styles.noPrint].join(' ')}><span><strong>이 브라우저의 기존 기록을 찾았습니다.</strong> 영업건 {legacy.sales.length}건 · 견적서 {legacy.quotes.length}건</span><button type="button" className={styles.primary} disabled={saving} onClick={importLegacy}>기존 기록 가져오기</button></div> : null}
    {loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={22} /> 공용 데이터를 불러오는 중입니다.</div> : null}
    {!loading && tab === 'sales' && !sale ? <SalesList
      sales={shownSales} selected={selectedSales} search={search} status={status}
      quoteYear={quoteYear} quoteMonth={quoteMonth} quoteYears={quoteYears} allPeriods={allPeriods}
      monthlyOpen={monthlyOpen} monthlySummary={monthlySummary} saving={saving}
      onSearch={setSearch} onStatus={setStatus} onYear={setQuoteYear} onMonth={setQuoteMonth}
      onAllPeriods={setAllPeriods} onMonthlyOpen={() => setMonthlyOpen((current) => !current)}
      onMonthPick={(month) => { setQuoteMonth(month); setAllPeriods(false) }}
      onResetFilters={() => { setSearch(''); setStatus('all'); setQuoteYear(dateToday().slice(0, 4)); setQuoteMonth(dateToday().slice(5, 7)); setAllPeriods(false) }}
      onNew={() => setSale(newSale())} onOpen={(entry) => setSale(normalizeSale(entry))}
      onCopy={(entry) => setSale(copySaleRecord(entry))} onCopySelected={copySelectedSale}
      onDelete={removeSale} onDeleteSelected={() => void deleteSelectedSales()}
      onQuickUpdate={updateSaleFromList}
      onToggle={(saleId) => setSelectedSales((current) => current.includes(saleId) ? current.filter((entry) => entry !== saleId) : [...current, saleId])}
      onAll={() => setSelectedSales((current) => shownSales.length && shownSales.every((entry) => current.includes(entry.id)) ? current.filter((entry) => !shownSales.some((saleEntry) => saleEntry.id === entry)) : [...new Set([...current, ...shownSales.map((entry) => entry.id)])])}
      onExport={exportSales} onImport={() => salesImportRef.current?.click()}
    /> : null}
    {!loading && tab === 'sales' && sale ? <SalesEditor sale={sale} clients={clients} totals={currentSaleTotals} saving={saving} onBack={() => setSale(null)} onChange={setSale} onUseClient={(client) => setSale((current) => current ? saleFromClient(current, client) : current)} onSave={saveSale} onDelete={() => void removeSale(sale.id)} onCopy={() => setSale(copySaleRecord(sale))} onQuote={() => openQuoteForSale(sale)} onSabangnet={downloadSabangnet} onAttach={uploadSaleAttachments} onDownloadAttachment={downloadSaleAttachment} onRemoveAttachment={removeSaleAttachment} onCatalog={(itemId, code) => applyCatalogItem(itemId, code, 'sale')} /> : null}
    {!loading && tab === 'quote' ? <QuoteEditor quote={quote} clients={clients} totals={currentQuoteTotals} saved={quotes} selected={selectedQuote} saving={saving} onChange={setQuote} onUseClient={(client) => setQuote((current) => quoteFromClient(current, client))} onSave={saveQuote} onDelete={removeQuote} onNew={() => { setQuote(newQuote(supplier)); setSelectedQuote('') }} onSelect={(quoteId) => { setSelectedQuote(quoteId); const selected = quotes.find((entry) => entry.id === quoteId); if (selected) setQuote(normalizeQuote(selected, supplier)) }} onCatalog={(itemId, code) => applyCatalogItem(itemId, code, 'quote')} onPrint={async () => { try { if (quote.id) await api('PATCH', { action: 'mark-printed', quoteId: quote.id }) } catch { /* printing stays available */ } window.print() }} /> : null}
    <datalist id="quote-catalog">{catalog.slice(0, 1000).flatMap((entry) => [
      <option key={`${entry.id}-sku`} value={entry.sku}>{entry.name}{entry.spec ? ' · ' + entry.spec : ''}</option>,
      <option key={`${entry.id}-name`} value={entry.name}>{entry.sku}{entry.spec ? ' · ' + entry.spec : ''}</option>,
    ])}</datalist>
    <input ref={salesImportRef} className={styles.hiddenInput} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importSales(file) }} />
  </div>
}

function SalesList(props: {
  sales: Sale[]; selected: string[]; search: string; status: 'all' | SalesStatus
  quoteYear: string; quoteMonth: string; quoteYears: string[]; allPeriods: boolean
  monthlyOpen: boolean; monthlySummary: MonthlySummary[]; saving: boolean
  onSearch: (input: string) => void; onStatus: (input: 'all' | SalesStatus) => void
  onYear: (input: string) => void; onMonth: (input: string) => void; onAllPeriods: (input: boolean) => void
  onMonthlyOpen: () => void; onMonthPick: (month: string) => void; onResetFilters: () => void; onNew: () => void
  onOpen: (sale: Sale) => void; onCopy: (sale: Sale) => void; onCopySelected: () => void
  onDelete: (saleId: string) => void; onDeleteSelected: () => void
  onQuickUpdate: (saleId: string, updater: (current: Sale) => Sale) => void
  onToggle: (saleId: string) => void; onAll: () => void; onExport: (scope: ExportScope, date?: string) => void; onImport: () => void
}) {
  const counts = (currentStatus: SalesStatus) => props.sales.filter((entry) => entry.status === currentStatus).length
  const allSelected = !!props.sales.length && props.sales.every((entry) => props.selected.includes(entry.id))
  const visibleSelected = props.sales.filter((entry) => props.selected.includes(entry.id)).length
  const monthlyTotal = props.monthlySummary.reduce((sum, item) => sum + item.totalGross, 0)
  return <main className={styles.page}>
    <section className={styles.listHead}><div><h1>영업관리</h1><p>거래처와 품목을 관리하고, 확정된 내용을 견적서로 바로 보냅니다.</p></div><div className={styles.actions}><a className={styles.light} href="/purchasing/items">품목 관리 <ExternalLink size={14} /></a><button type="button" className={styles.light} onClick={props.onImport} disabled={props.saving}><FileSpreadsheet size={15} /> 엑셀 가져오기</button><button type="button" className={styles.primary} onClick={props.onNew}><Plus size={15} /> 새 영업건</button></div></section>
    <div className={styles.cards}><Card label={props.allPeriods ? '전체 영업건' : `${props.quoteYear}년 ${Number(props.quoteMonth)}월 영업건`} value={props.sales.length} /><Card label="진행 중" value={counts('inProgress')} color="blue" /><Card label="전체 완료" value={counts('completed')} color="green" /><Card label="진행 불가" value={counts('blocked')} color="red" /></div>
    <section className={styles.listCard}>
      <div className={styles.filters}>
        <label className={styles.search}><Search size={16} /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="거래처, 담당자, 품목명 또는 품목코드 검색" /></label>
        <div className={styles.filterActions}><select value={props.status} onChange={(event) => props.onStatus(event.target.value as 'all' | SalesStatus)}><option value="all">전체 상태</option>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="button" className={styles.textButton} onClick={props.onResetFilters}>조건 초기화</button></div>
      </div>
      <div className={styles.periodBar}>
        <div className={styles.periodInputs}><strong>견적 기간</strong><select value={props.quoteYear} disabled={props.allPeriods} onChange={(event) => props.onYear(event.target.value)}>{props.quoteYears.map((year) => <option key={year} value={year}>{year}년</option>)}</select><select value={props.quoteMonth} disabled={props.allPeriods} onChange={(event) => props.onMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => { const month = String(index + 1).padStart(2, '0'); return <option key={month} value={month}>{Number(month)}월</option> })}</select><label className={styles.check}><input type="checkbox" checked={props.allPeriods} onChange={(event) => props.onAllPeriods(event.target.checked)} />전체 기간</label></div>
        <button type="button" className={styles.light} onClick={props.onMonthlyOpen}>월별 매출 요약 {props.monthlyOpen ? '접기' : '보기'}</button>
      </div>
      {props.monthlyOpen ? <div className={styles.monthlySummary}><div><strong>{props.quoteYear}년 월별 매출</strong><span>진행 중·전체 완료 영업건 기준 · 합계 {money(monthlyTotal)}</span></div><div className={styles.monthlyGrid}>{props.monthlySummary.map((item) => <button key={item.month} type="button" className={item.month === props.quoteMonth && !props.allPeriods ? styles.monthActive : styles.month} onClick={() => props.onMonthPick(item.month)}><strong>{Number(item.month)}월</strong><span>{item.count}건 / 반영 {item.activeCount}건</span><em>{money(item.totalGross)}</em></button>)}</div></div> : null}
      <div className={styles.listBulkBar}>
        <span>선택 {props.selected.length.toLocaleString('ko-KR')}건{visibleSelected !== props.selected.length ? ` · 현재 목록 ${visibleSelected}건` : ''}</span>
        <div className={styles.actions}><button type="button" className={styles.light} disabled={props.selected.length !== 1 || props.saving} onClick={props.onCopySelected}><Copy size={14} /> 선택 영업건 복사</button><button type="button" className={styles.danger} disabled={!props.selected.length || props.saving} onClick={props.onDeleteSelected}><Trash2 size={14} /> 선택 삭제</button><span className={styles.downloadLabel}>엑셀</span><button type="button" className={styles.light} disabled={props.saving} onClick={() => props.onExport('all')}><Download size={14} /> 전체</button><button type="button" className={styles.light} disabled={props.saving || !props.selected.length} onClick={() => props.onExport('selected')}><Download size={14} /> 선택</button><label className={styles.dateDownload}><input type="date" defaultValue={dateToday()} aria-label="견적일 다운로드" /><button type="button" className={styles.light} disabled={props.saving} onClick={(event) => { const input = event.currentTarget.parentElement?.querySelector('input'); props.onExport('date', input?.value || '') }}><Download size={14} /> 날짜별</button></label></div>
      </div>
      <div className={styles.scroll}><table className={styles.table}><thead><tr><th><input type="checkbox" aria-label="현재 목록 전체 선택" checked={allSelected} onChange={props.onAll} /></th><th>견적일</th><th>영업 상태</th><th>출고 현황</th><th>입금 현황</th><th>거래처</th><th>대표 품목</th><th>품목 수</th><th>총매출</th><th>총원가</th><th>총순이익</th><th /></tr></thead><tbody>{props.sales.length ? props.sales.map((entry) => {
        const total = calculateSalesMarginTotals({ items: entry.items.map((item) => ({ qty: item.qty, price: item.price, cost: item.cost, wholesalePrice: item.wholesalePrice, vatIncluded: item.vatIncluded })), includeShipping: entry.includeShipping, shippingFee: entry.shippingFee, shippingCost: entry.shippingCost, shippingVatIncluded: entry.shippingVatIncluded })
        const toggleTracking = (field: 'shipments' | 'payments', trackId: string) => props.onQuickUpdate(entry.id, (current) => {
          const rows = current[field].map((track) => track.id === trackId ? { ...track, status: (track.status === 'completed' ? 'before' : 'completed') as Track['status'] } : track)
          const shipments = field === 'shipments' ? rows : current.shipments
          const payments = field === 'payments' ? rows : current.payments
          return { ...current, shipments, payments, status: deriveSalesStatus(shipments, payments) }
        })
        const updateTrackingDate = (field: 'shipments' | 'payments', trackId: string, date: string) => props.onQuickUpdate(entry.id, (current) => ({
          ...current,
          [field]: current[field].map((track) => track.id === trackId ? { ...track, date } : track),
        }))
        return <tr key={entry.id}>
          <td><input type="checkbox" aria-label="영업건 선택" checked={props.selected.includes(entry.id)} onChange={() => props.onToggle(entry.id)} /></td>
          <td>{quoteDateOf(entry) || '-'}</td>
          <td><select className={[styles.listStatusSelect, styles['status' + entry.status] || ''].join(' ')} value={entry.status} aria-label={`${entry.clientName || '거래처 미입력'} 영업 상태`} onChange={(event) => props.onQuickUpdate(entry.id, (current) => ({ ...current, status: event.target.value as SalesStatus }))}>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td>
          <td><div className={styles.listTracking}>{entry.shipments.slice(0, 2).map((track, index) => <div key={track.id} className={styles.listTrackingRow}><button type="button" className={[styles.status, styles.listTrackingButton, styles['status' + (track.status === 'completed' ? 'completed' : 'pending')] || ''].join(' ')} onClick={() => toggleTracking('shipments', track.id)}>{track.status === 'completed' ? `출고완료 ${index + 1}` : `출고대기 ${index + 1}`}</button><input type="date" value={track.date} aria-label={`출고 ${index + 1}일`} onChange={(event) => updateTrackingDate('shipments', track.id, event.target.value)} /></div>)}{entry.shipments.length > 2 ? <small>+{entry.shipments.length - 2}건</small> : null}</div></td>
          <td><div className={styles.listTracking}>{entry.payments.slice(0, 2).map((track, index) => <div key={track.id} className={styles.listTrackingRow}><button type="button" className={[styles.status, styles.listTrackingButton, styles['status' + (track.status === 'completed' ? 'completed' : 'pending')] || ''].join(' ')} onClick={() => toggleTracking('payments', track.id)}>{track.status === 'completed' ? `입금완료 ${index + 1}` : `입금대기 ${index + 1}`}</button><input type="date" value={track.date} aria-label={`입금 ${index + 1}일`} onChange={(event) => updateTrackingDate('payments', track.id, event.target.value)} /></div>)}{entry.payments.length > 2 ? <small>+{entry.payments.length - 2}건</small> : null}</div></td>
          <td><button type="button" className={styles.textButton} onClick={() => props.onOpen(entry)}>{entry.clientName || '거래처 미입력'}</button></td>
          <td>{entry.items.find((item) => item.name)?.name || '-'}</td><td>{entry.items.length}</td><td>{money(total.totalGross)}</td><td>{money(total.totalCost)}</td><td>{money(total.totalProfit)}</td>
          <td className={styles.rowActions}><button type="button" onClick={() => props.onCopy(entry)} aria-label="영업건 복사"><Copy size={14} /></button><button type="button" onClick={() => props.onDelete(entry.id)} aria-label="영업건 삭제"><Trash2 size={14} /></button></td>
        </tr>
      }) : <tr><td colSpan={12} className={styles.empty}>조건에 맞는 영업건이 없습니다.</td></tr>}</tbody></table></div>
    </section>
  </main>
}


function Card({ label, value, color = '' }: { label: string; value: number; color?: string }) { return <div className={[styles.card, color ? styles[color] : ''].join(' ')}><span>{label}</span><strong>{value.toLocaleString('ko-KR')}</strong></div> }

function SalesEditor(props: {
  sale: Sale; clients: Client[]; totals: ReturnType<typeof calculateSalesMarginTotals> | null; saving: boolean
  onBack: () => void; onChange: (sale: Sale) => void; onSave: () => void; onDelete: () => void; onCopy: () => void; onQuote: () => void; onSabangnet: () => void
  onUseClient: (client: Client) => void; onAttach: (files: FileList | null) => void; onDownloadAttachment: (attachment: SaleAttachment) => void; onRemoveAttachment: (attachment: SaleAttachment) => void; onCatalog: (id: string, code: string) => void
}) {
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const update = <K extends keyof Sale>(field: K, input: Sale[K]) => props.onChange({ ...props.sale, [field]: input })
  const updateItem = <K extends keyof Item>(itemId: string, field: K, input: Item[K]) => props.onChange({ ...props.sale, items: props.sale.items.map((item) => item.id === itemId ? { ...item, [field]: input } : item) })
  const updateTracking = (shipments: Track[], payments: Track[]) => props.onChange({
    ...props.sale,
    shipments,
    payments,
    status: deriveSalesStatus(shipments, payments),
  })
  const updateTrack = (field: 'shipments' | 'payments', trackId: string, changes: Partial<Track>) => {
    const rows = props.sale[field].map((track) => track.id === trackId ? { ...track, ...changes } : track)
    if (field === 'shipments') updateTracking(rows, props.sale.payments)
    else updateTracking(props.sale.shipments, rows)
  }
  const selectClient = (clientId: string) => {
    if (!clientId) {
      update('customerId', null)
      return
    }
    const client = props.clients.find((entry) => entry.id === clientId)
    if (client) props.onUseClient(client)
  }
  return <main className={styles.page}>
    <div className={[styles.editorActions, styles.noPrint].join(' ')}><button type="button" className={styles.back} onClick={props.onBack}><ArrowLeft size={16} /> 영업관리</button><div className={styles.actions}><button type="button" className={styles.light} onClick={props.onCopy}><Copy size={15} /> 복사</button><button type="button" className={styles.light} onClick={props.onDelete}><Trash2 size={15} /> 삭제</button><button type="button" className={styles.light} onClick={props.onSabangnet}><Download size={15} /> 사방넷 등록 엑셀</button><button type="button" className={styles.light} onClick={props.onQuote}>견적서 작업</button><button type="button" className={styles.primary} disabled={props.saving} onClick={props.onSave}><Save size={15} /> {props.saving ? '저장 중' : '저장'}</button></div></div>
    <section className={styles.editorTitle}><div><h1>{props.sale.clientName || '새 영업건'}</h1><p>영업 조건, 출고·입금 현황, 수익을 한 화면에서 관리합니다.</p></div><select value={props.sale.status} onChange={(event) => update('status', event.target.value as SalesStatus)}>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></section>
    <div className={styles.editorGrid}><Section title="거래처 정보"><div className={styles.fields}><Field label="등록 거래처" wide><select className={styles.clientSelect} value={props.sale.customerId || ''} onChange={(event) => selectClient(event.target.value)}><option value="">직접 입력 또는 등록 거래처 선택</option>{props.clients.map((client) => <option key={client.id} value={client.id}>{client.clientName}{client.contactName ? ` · ${client.contactName}` : ''}</option>)}</select></Field><Field label="견적일"><input type="date" value={props.sale.quoteDate} onChange={(event) => update('quoteDate', event.target.value)} /></Field><Field label="영업일"><input type="date" value={props.sale.saleDate} onChange={(event) => update('saleDate', event.target.value)} /></Field><Field label="거래처명"><input value={props.sale.clientName} onChange={(event) => update('clientName', event.target.value)} /></Field><Field label="대표자"><input value={props.sale.representativeName} onChange={(event) => update('representativeName', event.target.value)} /></Field><Field label="담당자"><input value={props.sale.contactName} onChange={(event) => update('contactName', event.target.value)} /></Field><Field label="연락처"><input value={props.sale.contactPhone} onChange={(event) => update('contactPhone', event.target.value)} /></Field><Field label="사업자번호"><input value={props.sale.businessRegistrationNumber} onChange={(event) => update('businessRegistrationNumber', event.target.value)} /></Field><Field label="세금계산서 이메일"><input value={props.sale.taxInvoiceEmail} onChange={(event) => update('taxInvoiceEmail', event.target.value)} /></Field><Field label="주소" wide><input value={props.sale.address} onChange={(event) => update('address', event.target.value)} /></Field></div></Section>
      <Section title="수령·배송 정보"><div className={styles.fields}><Field label="수령인"><input value={props.sale.recipientName} onChange={(event) => update('recipientName', event.target.value)} /></Field><Field label="수령인 연락처"><input value={props.sale.recipientPhone} onChange={(event) => update('recipientPhone', event.target.value)} /></Field><Field label="희망 납기일"><input type="date" value={props.sale.requestedDueDate} onChange={(event) => update('requestedDueDate', event.target.value)} /></Field><Field label="수신 표기"><input value={props.sale.recipientTitle} onChange={(event) => update('recipientTitle', event.target.value)} /></Field><Field label="배송 메모" wide><textarea value={props.sale.deliveryMessage} onChange={(event) => update('deliveryMessage', event.target.value)} rows={2} /></Field></div></Section></div>
    <Section title="출고 · 입금 현황"><div className={styles.trackGrid}><Tracks title="출고 현황" rows={props.sale.shipments} onAdd={() => updateTracking([...props.sale.shipments, newTrack()], props.sale.payments)} onChange={(trackId, changes) => updateTrack('shipments', trackId, changes)} onRemove={(trackId) => updateTracking(props.sale.shipments.length > 1 ? props.sale.shipments.filter((track) => track.id !== trackId) : props.sale.shipments, props.sale.payments)} /><Tracks title="입금 현황" payment rows={props.sale.payments} onAdd={() => updateTracking(props.sale.shipments, [...props.sale.payments, newTrack()])} onChange={(trackId, changes) => updateTrack('payments', trackId, changes)} onRemove={(trackId) => updateTracking(props.sale.shipments, props.sale.payments.length > 1 ? props.sale.payments.filter((track) => track.id !== trackId) : props.sale.payments)} /></div></Section>
    <Section title="품목 및 수익"><div className={styles.scroll}><table className={styles.itemTable}><thead><tr><th>품목코드</th><th>품목명</th><th>옵션</th><th>수량</th><th>개당 원가</th><th>도매가</th><th>판매 단가</th><th>VAT</th><th>매출</th><th>순이익</th><th className={styles.noPrint} /></tr></thead><tbody>{props.sale.items.map((item) => { const margin = calculateSalesItemMargin({ qty: item.qty, price: item.price, cost: item.cost, wholesalePrice: item.wholesalePrice, vatIncluded: item.vatIncluded }); return <tr key={item.id}><td><input list="quote-catalog" value={item.productCode} onChange={(event) => props.onCatalog(item.id, event.target.value)} placeholder="코드·품명 검색" /></td><td><input value={item.name} onChange={(event) => updateItem(item.id, 'name', event.target.value)} /></td><td><input value={item.spec} onChange={(event) => updateItem(item.id, 'spec', event.target.value)} /></td><td><input type="number" min="0" value={item.qty} onChange={(event) => updateItem(item.id, 'qty', event.target.value)} /></td><td><input type="number" min="0" value={item.cost} onChange={(event) => updateItem(item.id, 'cost', event.target.value)} /></td><td><input type="number" min="0" value={item.wholesalePrice} onChange={(event) => updateItem(item.id, 'wholesalePrice', event.target.value)} /></td><td><input type="number" min="0" value={item.price} onChange={(event) => updateItem(item.id, 'price', event.target.value)} /></td><td><label className={styles.check}><input type="checkbox" checked={item.vatIncluded} onChange={(event) => updateItem(item.id, 'vatIncluded', event.target.checked)} />포함</label></td><td>{money(margin.totalGross)}</td><td>{money(margin.totalProfit)}<small>{percent(margin.totalProfitRate)}</small></td><td className={styles.noPrint}><button type="button" className={styles.icon} disabled={props.sale.items.length === 1} onClick={() => props.onChange({ ...props.sale, items: props.sale.items.filter((row) => row.id !== item.id) })}><Trash2 size={14} /></button></td></tr> })}</tbody></table></div><div className={[styles.actions, styles.noPrint].join(' ')}><button type="button" className={styles.light} onClick={() => props.onChange({ ...props.sale, items: [...props.sale.items, newItem()] })}><Plus size={14} /> 빈 품목 추가</button><button type="button" className={styles.light} disabled={!props.sale.items.length} onClick={() => { const previous = props.sale.items.at(-1); if (previous) props.onChange({ ...props.sale, items: [...props.sale.items, newItem({ ...previous, id: id('item') })] }) }}><Copy size={14} /> 이전 품목 복사</button></div><div className={styles.totals}><span>매출 {money(props.totals?.totalGross)}</span><span>원가 {money(props.totals?.totalCost)}</span><strong>순이익 {money(props.totals?.totalProfit)} <small>{percent(props.totals?.totalProfitRate)}</small></strong></div></Section>
    <div className={styles.editorGrid}><Section title="배송비"><label className={styles.check}><input type="checkbox" checked={props.sale.includeShipping} onChange={(event) => update('includeShipping', event.target.checked)} />배송비 청구</label>{props.sale.includeShipping ? <div className={styles.fields}><Field label="청구 배송비"><input type="number" min="0" value={props.sale.shippingFee} onChange={(event) => update('shippingFee', event.target.value)} /></Field><Field label="실제 배송비"><input type="number" min="0" value={props.sale.shippingCost} onChange={(event) => update('shippingCost', event.target.value)} /></Field><Field label="VAT 포함" wide><label className={styles.check}><input type="checkbox" checked={props.sale.shippingVatIncluded} onChange={(event) => update('shippingVatIncluded', event.target.checked)} />청구 배송비 VAT 포함</label></Field></div> : null}</Section><Section title="내부 메모 및 첨부파일"><textarea className={styles.memo} value={props.sale.internalMemo} onChange={(event) => update('internalMemo', event.target.value)} rows={4} placeholder="이 메모는 외부 견적서에 인쇄되지 않습니다." /><div className={styles.attachmentHeader}><div><strong>첨부파일</strong><p>파일당 4MB 이하 · 영업건 저장 후 첨부할 수 있습니다.</p></div><button type="button" className={styles.light} disabled={props.saving} onClick={() => attachmentInputRef.current?.click()}><Plus size={14} /> 파일 첨부</button></div><input ref={attachmentInputRef} className={styles.hiddenInput} type="file" multiple onChange={(event) => { const files = event.target.files; event.target.value = ''; if (files?.length) props.onAttach(files) }} />{props.sale.attachments.length ? <ul className={styles.attachmentList}>{props.sale.attachments.map((attachment) => <li key={attachment.id}><button type="button" className={styles.attachmentFile} onClick={() => props.onDownloadAttachment(attachment)}><span>{attachment.fileName}</span><small>{attachmentSize(attachment.fileSize)}</small></button><button type="button" className={styles.icon} disabled={props.saving} aria-label={`${attachment.fileName} 삭제`} onClick={() => props.onRemoveAttachment(attachment)}><Trash2 size={13} /></button></li>)}</ul> : <p className={styles.attachmentEmpty}>첨부파일이 없습니다.</p>}</Section></div>
  </main>
}

function QuoteEditor(props: {
  quote: Quote; clients: Client[]; totals: ReturnType<typeof calculateQuoteTotals>; saved: Quote[]; selected: string; saving: boolean
  onChange: (quote: Quote) => void; onUseClient: (client: Client) => void; onSave: () => void; onDelete: () => void; onNew: () => void; onSelect: (id: string) => void; onCatalog: (itemId: string, code: string) => void; onPrint: () => void
}) {
  const update = <K extends keyof Quote>(field: K, input: Quote[K]) => props.onChange({ ...props.quote, [field]: input })
  const updateItem = <K extends keyof Item>(itemId: string, field: K, input: Item[K]) => props.onChange({ ...props.quote, items: props.quote.items.map((item) => item.id === itemId ? { ...item, [field]: input } : item) })
  const updateSupplier = <K extends keyof Supplier>(field: K, input: Supplier[K]) => update('supplier', { ...props.quote.supplier, [field]: input })
  const selectClient = (clientId: string) => {
    if (!clientId) {
      update('customerId', null)
      return
    }
    const client = props.clients.find((entry) => entry.id === clientId)
    if (client) props.onUseClient(client)
  }
  return <main className={styles.quotePage}>
    <div className={[styles.quoteToolbar, styles.noPrint].join(' ')}><div className={styles.actions}><button type="button" className={styles.primary} disabled={props.saving} onClick={props.onSave}><Save size={15} /> {props.saving ? '저장 중' : '저장'}</button><select aria-label="등록 거래처" value={props.quote.customerId || ''} onChange={(event) => selectClient(event.target.value)}><option value="">등록 거래처 불러오기</option>{props.clients.map((client) => <option key={client.id} value={client.id}>{client.clientName}{client.contactName ? ` · ${client.contactName}` : ''}</option>)}</select><select value={props.selected} onChange={(event) => props.onSelect(event.target.value)}><option value="">저장된 견적서</option>{props.saved.map((entry) => <option key={entry.id} value={entry.id}>{titleOf(entry)}</option>)}</select><button type="button" className={styles.light} disabled={!props.selected} onClick={props.onDelete}><Trash2 size={15} /> 삭제</button><button type="button" className={styles.light} onClick={props.onNew}>새 견적서</button></div><button type="button" className={styles.print} onClick={props.onPrint}><Printer size={15} /> 인쇄 / PDF</button></div>
    <section className={styles.paper}><h1>견 적 서</h1><div className={styles.quoteInfo}><div className={styles.quoteLeft}><QField label="날 짜"><input type="date" value={props.quote.date} onChange={(event) => update('date', event.target.value)} /></QField><QField label="수 신"><input value={props.quote.recipient} onChange={(event) => update('recipient', event.target.value)} placeholder="거래처명" /></QField><QField label="참 조"><input value={props.quote.recipientTitle} onChange={(event) => update('recipientTitle', event.target.value)} /></QField><div className={styles.intro}><input value={props.quote.intro} onChange={(event) => update('intro', event.target.value)} /></div></div><div className={styles.supplier}><strong>공급자</strong><div><QField label="등록번호"><input value={props.quote.supplier.reg} onChange={(event) => updateSupplier('reg', event.target.value)} /></QField><div className={styles.two}><QField label="상 호"><input value={props.quote.supplier.name} onChange={(event) => updateSupplier('name', event.target.value)} /></QField><QField label="성 명"><input value={props.quote.supplier.rep} onChange={(event) => updateSupplier('rep', event.target.value)} /></QField></div><QField label="사업장 주소"><input value={props.quote.supplier.addr} onChange={(event) => updateSupplier('addr', event.target.value)} /></QField><div className={styles.two}><QField label="업 태"><input value={props.quote.supplier.biz} onChange={(event) => updateSupplier('biz', event.target.value)} /></QField><QField label="종 목"><input value={props.quote.supplier.type} onChange={(event) => updateSupplier('type', event.target.value)} /></QField></div><QField label="전화번호"><input value={props.quote.supplier.tel} onChange={(event) => updateSupplier('tel', event.target.value)} /></QField></div></div></div>
      <div className={styles.quoteTotal}><span>합계금액<small>(공급가액+세액)</small></span><div><strong>{money(props.totals.total)}</strong><em>{formatKoreanWon(props.totals.total)}</em></div></div>
      <div className={[styles.quoteAdd, styles.noPrint].join(' ')}><button type="button" className={styles.light} onClick={() => update('items', [...props.quote.items, newItem()])}><Plus size={14} /> 품목 추가</button></div>
      <div className={styles.scroll}><table className={styles.quoteTable}><thead><tr><th>No.</th><th>품명</th><th>옵션</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th><th>비고</th><th className={styles.noPrint} /></tr></thead><tbody>{props.quote.items.map((item, index) => { const line = calculateQuoteLineTotals(item); return <tr key={item.id}><td>{index + 1}</td><td><input list="quote-catalog" value={item.productCode || item.name} onChange={(event) => props.onCatalog(item.id, event.target.value)} placeholder="품목명 또는 코드" /><input className={styles.subInput} value={item.name} onChange={(event) => updateItem(item.id, 'name', event.target.value)} placeholder="표시할 품명" /></td><td><input value={item.spec} onChange={(event) => updateItem(item.id, 'spec', event.target.value)} /></td><td><input type="number" min="0" value={item.qty} onChange={(event) => updateItem(item.id, 'qty', event.target.value)} /></td><td><input type="number" min="0" value={item.price} onChange={(event) => updateItem(item.id, 'price', event.target.value)} /></td><td>{Math.round(line.supply).toLocaleString('ko-KR')}</td><td><label className={styles.check}><input type="checkbox" checked={item.vatIncluded} onChange={(event) => updateItem(item.id, 'vatIncluded', event.target.checked)} />{item.vatIncluded ? 'VAT포함' : Math.round(line.vat).toLocaleString('ko-KR')}</label></td><td><input value={item.note} onChange={(event) => updateItem(item.id, 'note', event.target.value)} /></td><td className={styles.noPrint}><button type="button" className={styles.icon} disabled={props.quote.items.length === 1} onClick={() => update('items', props.quote.items.filter((row) => row.id !== item.id))}><Trash2 size={14} /></button></td></tr> })}</tbody><tfoot><tr><td colSpan={5}>합 계</td><td>{Math.round(props.totals.supply).toLocaleString('ko-KR')}</td><td>{Math.round(props.totals.vat).toLocaleString('ko-KR')}</td><td colSpan={2} /></tr></tfoot></table></div>
      <div className={styles.notes}>{props.quote.notes.map((note, index) => <div key={index} className={styles.note}><span>※</span><textarea rows={1} value={note} onChange={(event) => update('notes', props.quote.notes.map((row, rowIndex) => rowIndex === index ? event.target.value : row))} /><button type="button" className={[styles.icon, styles.noPrint].join(' ')} onClick={() => update('notes', props.quote.notes.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={13} /></button></div>)}<button type="button" className={[styles.light, styles.noPrint].join(' ')} onClick={() => update('notes', [...props.quote.notes, ''])}><Plus size={14} /> 비고 추가</button></div>
    </section>
  </main>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className={styles.section}><h2>{title}</h2>{children}</section> }
function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={wide ? styles.fieldWide : styles.field}><span>{label}</span>{children}</label> }
function QField({ label, children }: { label: string; children: React.ReactNode }) { return <label className={styles.qField}><span>{label}</span>{children}</label> }
function Tracks({ title, rows, payment = false, onAdd, onChange, onRemove }: { title: string; rows: Track[]; payment?: boolean; onAdd: () => void; onChange: (id: string, input: Partial<Track>) => void; onRemove: (id: string) => void }) {
  return <div className={styles.track}><div><strong>{title}</strong><button type="button" className={styles.textButton} onClick={onAdd}><Plus size={14} /> 추가</button></div>{rows.map((row) => <div className={styles.trackRow} key={row.id}><select value={row.status} onChange={(event) => onChange(row.id, { status: event.target.value as Track['status'] })}><option value="before">{payment ? '입금 대기' : '출고대기'}</option><option value="completed">{payment ? '입금완료' : '출고완료'}</option></select><input type="date" value={row.date} onChange={(event) => onChange(row.id, { date: event.target.value })} />{payment ? <input type="number" value={row.amount || ''} onChange={(event) => onChange(row.id, { amount: event.target.value })} placeholder="입금액" /> : null}<input value={row.memo} onChange={(event) => onChange(row.id, { memo: event.target.value })} placeholder="메모" /><button type="button" className={styles.icon} disabled={rows.length === 1} onClick={() => onRemove(row.id)}><Trash2 size={13} /></button></div>)}</div>
}
