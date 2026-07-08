'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { FolderOpen, Plus, Printer, Save, Trash2 } from 'lucide-react'
import styles from './page.module.css'

type QuoteItem = {
  id: number
  name: string
  spec: string
  qty: number | string
  price: number | string
  vatIncluded: boolean
  note: string
}

type Supplier = {
  reg: string
  name: string
  rep: string
  addr: string
  biz: string
  type: string
  tel: string
}

type SavedQuote = {
  id: string
  date: string
  recipient: string
  recipientTitle: string
  intro: string
  items: QuoteItem[]
  notes: string[]
  supplier: Supplier
  savedAt: string
  title: string
}

const STORAGE_KEY = 'funtastic-quote-history'

const initialItems: QuoteItem[] = [
  { id: 1, name: '', spec: 'EA', qty: '', price: '', vatIncluded: false, note: '' },
]

const defaultSupplier: Supplier = {
  reg: '285-86-00885',
  name: '테이포프(주)',
  rep: '한상철',
  addr: '경기도 광주시 직동로8',
  biz: '도매 및 소매업',
  type: '전자상거래업',
  tel: '영업팀 (070-7525-7790)',
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function comma(value: number | string) {
  return Math.round(Number(value) || 0).toLocaleString('ko-KR')
}

function formatQuoteDate(date: Date | string = new Date()) {
  const parsed = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date
  return `${parsed.getMonth() + 1}월 ${parsed.getDate()}일`
}

function createDefaultNotes() {
  return [
    `본 견적서는 ${formatQuoteDate()}에 진행된 발주에 대한 견적서입니다.`,
    '본 견적서의 납기일정은 약 2-3주 정도 소요 됩니다.',
    '테이포프(주) 입금계좌: 035-102609-01-026 기업은행',
    '배송은 택배를 통해 발송되며, 택배사는 대한통운입니다.',
    '본 견적서는 발행일로부터 30일동안 유효합니다.',
    '대량건은 단순변심으로 환불이 어려우며, 불량품에 한하여 7일 이내 교환 및 환불 가능합니다.',
  ]
}

function toKorean(value: number | string) {
  const num = Math.round(Number(value) || 0)
  if (num === 0) return '금영원정'

  const units = ['', '만', '억', '조']
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  const positions = ['', '십', '백', '천']
  let result = ''
  let remaining = num
  let unitIndex = 0

  while (remaining > 0) {
    const chunk = remaining % 10000
    if (chunk > 0) {
      let chunkText = ''
      let cursor = chunk

      for (let index = 0; index < 4; index += 1) {
        const digit = cursor % 10
        if (digit > 0) {
          chunkText = `${digit === 1 && index > 0 ? '' : digits[digit]}${positions[index]}${chunkText}`
        }
        cursor = Math.floor(cursor / 10)
      }

      result = `${chunkText}${units[unitIndex]}${result}`
    }

    remaining = Math.floor(remaining / 10000)
    unitIndex += 1
  }

  return `금${result}원정`
}

function resizeTextArea(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight + 8}px`
}

export default function QuotesPage() {
  const [date, setDate] = useState(today())
  const [recipient, setRecipient] = useState('')
  const [recipientTitle, setRecipientTitle] = useState('대표이사 귀하')
  const [intro, setIntro] = useState('아래와 같이 납품 및 청구합니다.')
  const [items, setItems] = useState<QuoteItem[]>(initialItems)
  const [notes, setNotes] = useState(createDefaultNotes)
  const [supplier, setSupplier] = useState<Supplier>(defaultSupplier)
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([])
  const [selectedQuoteId, setSelectedQuoteId] = useState('')

  useLayoutEffect(() => {
    const resizeAll = () => {
      document
        .querySelectorAll<HTMLTextAreaElement>('textarea[data-autosize="true"]')
        .forEach(resizeTextArea)
    }

    resizeAll()
    window.addEventListener('beforeprint', resizeAll)
    return () => window.removeEventListener('beforeprint', resizeAll)
  }, [items, notes])

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
      setSavedQuotes(Array.isArray(saved) ? saved : [])
    } catch {
      setSavedQuotes([])
    }
  }, [])

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, item) => {
          const supply = (Number(item.qty) || 0) * (Number(item.price) || 0)
          const vat = item.vatIncluded ? 0 : Math.round(supply * 0.1)
          return {
            supply: acc.supply + supply,
            vat: acc.vat + vat,
            total: acc.total + supply + vat,
          }
        },
        { supply: 0, vat: 0, total: 0 },
      ),
    [items],
  )

  const updateSupplier = (field: keyof Supplier, value: string) => {
    setSupplier((prev) => ({ ...prev, [field]: value }))
  }

  const updateItem = useCallback((id: number, field: keyof QuoteItem, value: QuoteItem[keyof QuoteItem]) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)))
  }, [])

  const addItem = () => {
    const newId = Math.max(...items.map((item) => item.id), 0) + 1
    setItems((prev) => [
      ...prev,
      { id: newId, name: '', spec: 'EA', qty: 1, price: 0, vatIncluded: false, note: '' },
    ])
  }

  const removeItem = (id: number) => {
    if (items.length === 1) return
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  const updateNote = (index: number, value: string) => {
    setNotes((prev) => prev.map((note, noteIndex) => (noteIndex === index ? value : note)))
  }

  const addNote = () => setNotes((prev) => [...prev, ''])
  const removeNote = (index: number) => setNotes((prev) => prev.filter((_, noteIndex) => noteIndex !== index))

  const persistQuotes = (quotes: SavedQuote[]) => {
    setSavedQuotes(quotes)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(quotes))
    } catch {
      // Keep the active quote usable even when localStorage is unavailable.
    }
  }

  const makeQuoteSnapshot = () => ({
    date,
    recipient,
    recipientTitle,
    intro,
    items,
    notes,
    supplier,
  })

  const quoteLabel = (quote: Partial<SavedQuote>) => {
    const firstItem = quote.items?.find((item) => item.name.trim())?.name.trim()
    return `${quote.recipient?.trim() || '거래처 미입력'} / ${quote.date || '날짜 없음'} / ${firstItem || '품목 미입력'}`
  }

  const saveQuote = () => {
    const snapshot = makeQuoteSnapshot()
    const id = `${Date.now()}`
    const quote: SavedQuote = {
      id,
      ...snapshot,
      savedAt: new Date().toISOString(),
      title: quoteLabel(snapshot),
    }

    persistQuotes([quote, ...savedQuotes])
    setSelectedQuoteId(id)
  }

  const loadQuote = () => {
    const quote = savedQuotes.find((saved) => saved.id === selectedQuoteId)
    if (!quote) return

    setDate(quote.date || today())
    setRecipient(quote.recipient || '')
    setRecipientTitle(quote.recipientTitle || '대표이사 귀하')
    setIntro(quote.intro || '아래와 같이 납품 및 청구합니다.')
    setItems(quote.items?.length ? quote.items : initialItems)
    setNotes(quote.notes?.length ? quote.notes : createDefaultNotes())
    setSupplier(quote.supplier || defaultSupplier)
  }

  const deleteQuote = () => {
    if (!selectedQuoteId) return
    const quote = savedQuotes.find((saved) => saved.id === selectedQuoteId)
    if (quote && !window.confirm(`${quote.title || quoteLabel(quote)} 저장 기록을 삭제할까요?`)) return

    persistQuotes(savedQuotes.filter((saved) => saved.id !== selectedQuoteId))
    setSelectedQuoteId('')
  }

  const handlePrint = () => {
    document
      .querySelectorAll<HTMLTextAreaElement>('textarea[data-autosize="true"]')
      .forEach(resizeTextArea)
    window.print()
  }

  return (
    <div className={styles.quoteWorkspace}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLogo}>견적서</div>
        <div className={styles.toolbarActions}>
          <button className={styles.toolbarButton} type="button" onClick={saveQuote}>
            <Save className={styles.icon} />
            저장
          </button>
          <select
            className={styles.quoteSelect}
            value={selectedQuoteId}
            onChange={(event) => setSelectedQuoteId(event.target.value)}
          >
            <option value="">저장된 견적서</option>
            {savedQuotes.map((quote) => (
              <option key={quote.id} value={quote.id}>
                {quote.title || quoteLabel(quote)}
              </option>
            ))}
          </select>
          <button className={styles.toolbarButton} type="button" onClick={loadQuote} disabled={!selectedQuoteId}>
            <FolderOpen className={styles.icon} />
            불러오기
          </button>
          <button className={styles.toolbarButton} type="button" onClick={deleteQuote} disabled={!selectedQuoteId}>
            <Trash2 className={styles.icon} />
            삭제
          </button>
          <button className={styles.toolbarButton} type="button" onClick={addItem}>
            <Plus className={styles.icon} />
            품목
          </button>
          <button className={`${styles.toolbarButton} ${styles.printButton}`} type="button" onClick={handlePrint}>
            <Printer className={styles.icon} />
            인쇄 / PDF
          </button>
        </div>
      </div>

      <div className={styles.page}>
        <div className={styles.quotePaper}>
          <div className={styles.quoteTitle}>견 적 서</div>

          <div className={styles.infoGrid}>
            <div className={styles.infoLeft}>
              <InfoRow label="날 짜">
                <input
                  className={styles.editableInline}
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </InfoRow>
              <InfoRow label="수 신">
                <input
                  className={styles.editableInline}
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="거래처명"
                />
              </InfoRow>
              <InfoRow label="참 조">
                <input
                  className={styles.editableInline}
                  value={recipientTitle}
                  onChange={(event) => setRecipientTitle(event.target.value)}
                  placeholder="대표님 귀하"
                />
              </InfoRow>
              <div className={styles.introRow}>
                <input
                  className={styles.editableInline}
                  value={intro}
                  onChange={(event) => setIntro(event.target.value)}
                />
              </div>
            </div>

            <div className={styles.supplierWrap}>
              <div className={styles.supplierRibbon}>공급자</div>
              <div className={styles.supplierFields}>
                <InfoRow label="등록번호" compact>
                  <input
                    className={`${styles.editableInline} ${styles.centerText}`}
                    value={supplier.reg}
                    onChange={(event) => updateSupplier('reg', event.target.value)}
                  />
                </InfoRow>
                <div className={styles.splitRow}>
                  <InfoRow label="상 호" compact>
                    <input
                      className={styles.editableInline}
                      value={supplier.name}
                      onChange={(event) => updateSupplier('name', event.target.value)}
                    />
                  </InfoRow>
                  <InfoRow label="성 명" compact>
                    <input
                      className={styles.editableInline}
                      value={supplier.rep}
                      onChange={(event) => updateSupplier('rep', event.target.value)}
                    />
                  </InfoRow>
                </div>
                <InfoRow label="사업장 주소" compact>
                  <input
                    className={styles.editableInline}
                    value={supplier.addr}
                    onChange={(event) => updateSupplier('addr', event.target.value)}
                  />
                </InfoRow>
                <div className={styles.splitRow}>
                  <InfoRow label="업 태" compact>
                    <input
                      className={styles.editableInline}
                      value={supplier.biz}
                      onChange={(event) => updateSupplier('biz', event.target.value)}
                    />
                  </InfoRow>
                  <InfoRow label="종 목" compact>
                    <input
                      className={styles.editableInline}
                      value={supplier.type}
                      onChange={(event) => updateSupplier('type', event.target.value)}
                    />
                  </InfoRow>
                </div>
                <InfoRow label="전화번호" compact last>
                  <input
                    className={styles.editableInline}
                    value={supplier.tel}
                    onChange={(event) => updateSupplier('tel', event.target.value)}
                  />
                </InfoRow>
              </div>
            </div>
          </div>

          <div className={styles.totalBox}>
            <div className={styles.totalLabel}>
              합계금액
              <br />
              <span>(공급가액+세액)</span>
            </div>
            <div>
              <div className={styles.totalAmount}>₩ {comma(totals.total)}</div>
              <div className={styles.totalText}>{toKorean(totals.total)}</div>
            </div>
          </div>

          <div className={styles.actionRow}>
            <button className={styles.lightButton} type="button" onClick={addItem}>
              <Plus className={styles.smallIcon} />
              품목 추가
            </button>
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.itemsTable}>
              <thead>
                <tr>
                  <th className={styles.noColumn}>No.</th>
                  <th>품명</th>
                  <th className={styles.specColumn}>규격</th>
                  <th className={styles.qtyColumn}>수량</th>
                  <th className={styles.priceColumn}>단가</th>
                  <th className={styles.amountColumn}>공급가액</th>
                  <th className={styles.vatColumn}>세액</th>
                  <th className={styles.noteColumn}>비고</th>
                  <th className={`${styles.deleteColumn} ${styles.noPrint}`} />
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const supply = (Number(item.qty) || 0) * (Number(item.price) || 0)
                  const vat = item.vatIncluded ? 0 : Math.round(supply * 0.1)

                  return (
                    <tr key={item.id}>
                      <td className={styles.centerText}>{index + 1}</td>
                      <td>
                        <textarea
                          className={`${styles.editable} ${styles.itemName}`}
                          data-autosize="true"
                          value={item.name}
                          onChange={(event) => {
                            updateItem(item.id, 'name', event.target.value)
                            resizeTextArea(event.currentTarget)
                          }}
                          onInput={(event) => resizeTextArea(event.currentTarget)}
                          placeholder="품명"
                          rows={1}
                        />
                      </td>
                      <td>
                        <input
                          className={`${styles.editable} ${styles.centerText}`}
                          value={item.spec}
                          onChange={(event) => updateItem(item.id, 'spec', event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className={`${styles.editable} ${styles.numberInput}`}
                          type="number"
                          min="0"
                          value={item.qty}
                          onChange={(event) => updateItem(item.id, 'qty', event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className={`${styles.editable} ${styles.numberInput}`}
                          type="number"
                          min="0"
                          value={item.price}
                          onChange={(event) => updateItem(item.id, 'price', event.target.value)}
                        />
                      </td>
                      <td className={styles.numericText}>{comma(supply)}</td>
                      <td className={styles.centerText}>
                        <label className={styles.vatToggle}>
                          <input
                            type="checkbox"
                            checked={item.vatIncluded}
                            onChange={(event) => updateItem(item.id, 'vatIncluded', event.target.checked)}
                          />
                          {item.vatIncluded ? 'VAT포함' : comma(vat)}
                        </label>
                      </td>
                      <td>
                        <input
                          className={styles.editable}
                          value={item.note}
                          onChange={(event) => updateItem(item.id, 'note', event.target.value)}
                        />
                      </td>
                      <td className={`${styles.centerText} ${styles.noPrint}`}>
                        <button
                          className={`${styles.lightButton} ${styles.deleteButton}`}
                          type="button"
                          onClick={() => removeItem(item.id)}
                          aria-label={`${index + 1}번 품목 삭제`}
                        >
                          <Trash2 className={styles.smallIcon} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className={styles.centerText}>
                    합 계
                  </td>
                  <td className={styles.numericText}>{comma(totals.supply)}</td>
                  <td className={styles.numericText}>{comma(totals.vat)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className={styles.notes}>
            {notes.map((note, index) => (
              <div key={index} className={styles.noteItem}>
                <span className={styles.notePrefix}>※</span>
                <textarea
                  className={styles.noteText}
                  data-autosize="true"
                  value={note}
                  onChange={(event) => {
                    updateNote(index, event.target.value)
                    resizeTextArea(event.currentTarget)
                  }}
                  onInput={(event) => resizeTextArea(event.currentTarget)}
                  rows={1}
                />
                <button
                  className={`${styles.lightButton} ${styles.deleteButton} ${styles.noPrint}`}
                  type="button"
                  onClick={() => removeNote(index)}
                  aria-label={`${index + 1}번 비고 삭제`}
                >
                  <Trash2 className={styles.smallIcon} />
                </button>
              </div>
            ))}
            <button className={`${styles.lightButton} ${styles.noPrint}`} type="button" onClick={addNote}>
              <Plus className={styles.smallIcon} />
              비고 추가
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({
  label,
  children,
  compact = false,
  last = false,
}: {
  label: string
  children: ReactNode
  compact?: boolean
  last?: boolean
}) {
  return (
    <div className={`${styles.infoRow} ${compact ? styles.compactInfoRow : ''} ${last ? styles.lastInfoRow : ''}`}>
      <span className={styles.infoLabel}>{label}</span>
      <div className={styles.infoValue}>{children}</div>
    </div>
  )
}
