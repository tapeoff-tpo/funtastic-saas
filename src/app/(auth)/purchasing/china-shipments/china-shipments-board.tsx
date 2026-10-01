'use client'

import { type ChangeEvent, type FormEvent, type ReactNode, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, PackagePlus, Plus, Send, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundBoxDimensions, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { CHINA_OUTBOUND_DESTINATIONS } from '@/lib/purchasing/china-outbound-destinations'
import {
  addChinaOutboundShipmentItemsAction,
  assignChinaOutboundBoxesToPalletsAction,
  cancelChinaOutboundShipmentAction,
  createChinaOutboundShipmentAction,
  deleteChinaOutboundShipmentAction,
  dispatchChinaOutboundShipmentAction,
  markChinaOutboundShipmentReadyAction,
  saveChinaOutboundItemBoxSplitsAction,
  updateChinaOutboundShipmentAction,
} from '../saas-china-actions'

export type ChinaShipmentStockItem = {
  id: string
  warehouseCode: string
  sku: string
  productName: string
  optionName: string | null
  onHandQuantity: number
  reservedQuantity: number
  availableQuantity: number
}

export type ChinaShipmentListItem = {
  id: string
  shipmentNo: string
  displayName: string | null
  status: string
  originWarehouseCode: string
  destinationName: string | null
  plannedOutboundDate: string | null
  createdAt: string
  itemCount: number
  reservedQuantity: number
  packedQuantity: number
}

export type ChinaShipmentStage = 'items' | 'boxes' | 'pallets' | 'summary'

export type ChinaShipmentDetailView = {
  shipment: {
    id: string
    shipmentNo: string
    displayName: string | null
    status: string
    originWarehouseCode: string
    destinationName: string | null
    destinationAddress: string | null
    forwarderName: string | null
    externalReference: string | null
    plannedOutboundDate: string | null
    memo: string | null
    createdAt: string
  }
  items: Array<{
    id: string
    inventoryId: string
    warehouseCode: string
    sku: string
    productName: string
    optionName: string | null
    reservedQuantity: number
    packedQuantity: number
    dispatchedQuantity: number
  }>
  pallets: Array<{ id: string; palletNo: string; note: string | null }>
  boxes: Array<{
    id: string
    shipmentId: string
    editable: boolean
    palletId: string | null
    boxNo: string
    status: string
    note: string | null
    lengthCm: number | null
    widthCm: number | null
    heightCm: number | null
  }>
  boxItems: Array<{ id: string; boxId: string; shipmentItemId: string; quantity: number }>
}

type BoxSplitDraft = { key: string; boxNo: string; quantity: string; lengthCm: string; widthCm: string; heightCm: string }
type WorkbookPreview = {
  boxSplits: Array<{ shipmentItemId: string; allocations: Array<{ boxNo: string; quantity: number }> }>
  palletAssignments: Array<{ boxNo: string; palletNo: string | null }>
  summary: { boxSplitItemCount: number; boxSplitRowCount: number; palletAssignmentCount: number; boxCount: number }
  errors: Array<{ sheet: string; row: number; message: string }>
}

const inputClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60'
const compactInputClass = 'h-8 w-full rounded-md border bg-background px-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60'
const editableStatuses = new Set(['draft', 'packing'])
const statusLabels: Record<string, string> = {
  draft: '초안',
  packing: '포장중',
  ready: '포장완료',
  dispatched: '출고완료',
  cancelled: '취소',
}

export function ChinaShipmentsBoard({
  inventoryItems,
  shipments,
  selectedShipment,
  selectedStep,
  showCreate,
}: {
  inventoryItems: ChinaShipmentStockItem[]
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView | null
  selectedStep: ChinaShipmentStage
  showCreate: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [stockSearch, setStockSearch] = useState('')
  const [selectedWarehouseCodes, setSelectedWarehouseCodes] = useState<string[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [destinationName, setDestinationName] = useState('')
  const [plannedOutboundDate, setPlannedOutboundDate] = useState(today())
  const [displayName, setDisplayName] = useState(() => defaultShipmentDisplayName(today()))
  const [displayNameIsDateDefault, setDisplayNameIsDateDefault] = useState(true)
  const [memo, setMemo] = useState('')

  const availableInventory = inventoryItems.filter((item) => item.availableQuantity > 0)
  const availableQuantityByWarehouse = new Map<string, number>()
  for (const item of availableInventory) {
    availableQuantityByWarehouse.set(item.warehouseCode, (availableQuantityByWarehouse.get(item.warehouseCode) ?? 0) + item.availableQuantity)
  }
  const warehouseOptions = [...availableQuantityByWarehouse.keys()]
    .sort((left, right) => left.localeCompare(right, 'ko-KR', { numeric: true }))
  const selectedWarehouseInventory = availableInventory.filter((item) => selectedWarehouseCodes.includes(item.warehouseCode))
  const allWarehouseSelected = warehouseOptions.length > 0 && warehouseOptions.every((warehouseCode) => selectedWarehouseCodes.includes(warehouseCode))
  const stockSearchKeyword = stockSearch.trim().toLocaleLowerCase('ko-KR')
  const shownInventory = !stockSearchKeyword
    ? selectedWarehouseInventory
    : selectedWarehouseInventory.filter((item) => [item.sku, item.productName, item.optionName ?? '']
      .some((value) => value.toLocaleLowerCase('ko-KR').includes(stockSearchKeyword)))
  const stagedShipmentLines = availableInventory.flatMap((item) => {
    const quantity = Number(quantities[item.id] ?? 0)
    return Number.isInteger(quantity) && quantity > 0 ? [{ inventoryId: item.id, quantity }] : []
  })
  const stagedOutboundQuantity = stagedShipmentLines.reduce((total, line) => total + line.quantity, 0)

  function fillAllOutboundQuantities() {
    setQuantities((current) => ({
      ...current,
      ...Object.fromEntries(shownInventory.map((item) => [item.id, String(item.availableQuantity)])),
    }))
  }

  function toggleWarehouseSelection(warehouseCode: string) {
    setSelectedWarehouseCodes((current) => current.includes(warehouseCode)
      ? current.filter((code) => code !== warehouseCode)
      : [...current, warehouseCode])
  }

  function toggleAllWarehouseSelections() {
    setSelectedWarehouseCodes(allWarehouseSelected ? [] : warehouseOptions)
  }

  function changePlannedOutboundDate(nextDate: string) {
    setPlannedOutboundDate(nextDate)
    if (displayNameIsDateDefault) setDisplayName(defaultShipmentDisplayName(nextDate))
  }

  function createShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createChinaOutboundShipmentAction({
        displayName,
        destinationName,
        plannedOutboundDate: plannedOutboundDate || null,
        memo,
        lines: stagedShipmentLines,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (!result.shipmentId) {
        toast.error('중국출고요청을 열지 못했습니다. 다시 시도해주세요.')
        return
      }

      toast.success('중국출고요청을 만들고 출고 재고를 예약했습니다.')
      setQuantities({})
      setSelectedWarehouseCodes([])
      setDestinationName('')
      const nextDate = today()
      setPlannedOutboundDate(nextDate)
      setDisplayName(defaultShipmentDisplayName(nextDate))
      setDisplayNameIsDateDefault(true)
      setMemo('')
      window.location.replace(shipmentHref(result.shipmentId, 'items'))
    })
  }

  return (
    <div className="space-y-4" aria-busy={isPending}>
      <div className="space-y-3">
        <ShipmentSelector
          key={showCreate ? 'new-shipment' : selectedShipment?.shipment.id ?? 'no-shipment'}
          shipments={shipments}
          selectedShipment={showCreate ? null : selectedShipment?.shipment ?? null}
          showCreate={showCreate}
          onToggleCreate={() => window.location.replace(showCreate ? '/purchasing/china-shipments' : '/purchasing/china-shipments?create=1')}
          onSelect={(id) => {
            window.location.replace(shipmentHref(id, 'items'))
          }}
        />
        {showCreate ? (
          <section className="rounded-lg border bg-card">
          <form onSubmit={createShipment} className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="출고작업명"><input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setDisplayNameIsDateDefault(false) }} className={inputClass} placeholder="예: 2026-10-01 중국출고" /></Field>
              <Field label="도착지"><select value={destinationName} onChange={(event) => setDestinationName(event.target.value)} className={inputClass} required><option value="">도착지 선택</option>{CHINA_OUTBOUND_DESTINATIONS.map((destination) => <option key={destination} value={destination}>{destination}</option>)}</select></Field>
              <Field label="출고예정일"><input type="date" value={plannedOutboundDate} onChange={(event) => changePlannedOutboundDate(event.target.value)} className={inputClass} /></Field>
            </div>
            <Field label="메모"><input value={memo} onChange={(event) => setMemo(event.target.value)} className={inputClass} placeholder="포워더, 출고 목적 등" /></Field>

            <section className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">출고 재고 위치</h3>
                  <p className="mt-1 text-xs text-muted-foreground">여러 창고의 재고를 하나의 중국출고요청에 함께 넣을 수 있습니다.</p>
                </div>
                <button type="button" onClick={toggleAllWarehouseSelections} disabled={warehouseOptions.length === 0} className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60">
                  {allWarehouseSelected ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="출고 재고 위치 선택">
                {warehouseOptions.map((warehouseCode) => (
                  <label key={warehouseCode} className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${selectedWarehouseCodes.includes(warehouseCode) ? 'border-primary bg-primary/5 text-primary' : 'bg-background hover:bg-muted'}`}>
                    <input type="checkbox" checked={selectedWarehouseCodes.includes(warehouseCode)} onChange={() => toggleWarehouseSelection(warehouseCode)} className="size-4 accent-primary" />
                    <span>{warehouseCode}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{(availableQuantityByWarehouse.get(warehouseCode) ?? 0).toLocaleString('ko-KR')}개</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">출고할 상품과 수량</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedWarehouseInventory.length > 0 ? `선택한 ${selectedWarehouseCodes.length.toLocaleString('ko-KR')}개 창고의 작업 가능 재고입니다.` : '출고할 재고 위치를 하나 이상 체크해주세요.'}</p>
                </div>
                <button type="button" onClick={fillAllOutboundQuantities} disabled={selectedWarehouseInventory.length === 0} className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">보이는 상품 전체수량</button>
              </div>
              {stagedShipmentLines.length > 0 ? <p className="mt-3 text-xs font-medium text-primary">입력된 출고수량: {stagedShipmentLines.length.toLocaleString('ko-KR')}개 품목 · 전체 {stagedOutboundQuantity.toLocaleString('ko-KR')}개</p> : null}
              {selectedWarehouseInventory.length > 0 ? (
                <>
                  <input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} className="mt-3 h-9 w-full rounded-md border bg-background px-3 text-sm sm:max-w-sm" placeholder="상품명, 상품코드, 옵션 검색" />
                  <div className="mt-3 max-h-[440px] space-y-2 overflow-y-auto pr-1">
                    {shownInventory.length === 0 ? <p className="rounded-md border bg-background px-3 py-8 text-center text-sm text-muted-foreground">조건에 맞는 작업 가능 재고가 없습니다.</p> : shownInventory.map((item) => (
                      <article key={item.id} className="rounded-md border bg-background p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-muted-foreground">출고 창고: {item.warehouseCode}</p>
                            <p className="mt-1 truncate font-medium">{item.productName}</p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</p>
                          </div>
                          <div className="flex items-end gap-3">
                            <div className="text-right text-xs text-muted-foreground"><p>현재고 {item.onHandQuantity.toLocaleString('ko-KR')}개</p><p className="mt-1 font-medium text-emerald-700">작업 가능 {item.availableQuantity.toLocaleString('ko-KR')}개</p></div>
                            <label className="block"><span className="mb-1 block text-xs text-muted-foreground">이번 출고</span><input type="number" min="0" max={item.availableQuantity} step="1" value={quantities[item.id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="h-9 w-24 rounded-md border px-2 text-right text-sm tabular-nums" placeholder="0" /></label>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : <p className="mt-3 rounded-md border border-dashed bg-background px-3 py-10 text-center text-sm text-muted-foreground">출고할 재고 위치를 하나 이상 체크하면 해당 창고의 상품과 작업 가능 수량이 나옵니다.</p>}
            </section>
            <div className="flex justify-end"><button type="submit" disabled={isPending || !destinationName || stagedShipmentLines.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 중국출고요청 만들기</button></div>
          </form>
          </section>
        ) : null}
        {!showCreate ? <ShipmentDetailPanel
          key={selectedShipment?.shipment.id ?? 'no-shipment'}
          detail={selectedShipment}
          inventoryItems={inventoryItems}
          stage={selectedStep}
          isPending={isPending}
          startTransition={startTransition}
          onStageChange={(stage) => selectedShipment && window.location.replace(shipmentHref(selectedShipment.shipment.id, stage))}
        /> : null}
      </div>
    </div>
  )
}

function ShipmentSelector({ shipments, selectedShipment, showCreate, onToggleCreate, onSelect }: {
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView['shipment'] | null
  showCreate: boolean
  onToggleCreate: () => void
  onSelect: (id: string) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isEditing, setIsEditing] = useState(false)
  const [draftDisplayName, setDraftDisplayName] = useState(() => selectedShipment?.displayName ?? defaultShipmentDisplayName(selectedShipment?.plannedOutboundDate ?? null))
  const [draftPlannedOutboundDate, setDraftPlannedOutboundDate] = useState(() => selectedShipment?.plannedOutboundDate ?? '')
  const activeShipments = shipments.filter((shipment) => shipment.status !== 'cancelled')

  function saveShipmentDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedShipment) return
    startTransition(async () => {
      const result = await updateChinaOutboundShipmentAction({
        shipmentId: selectedShipment.id,
        displayName: draftDisplayName.trim() || null,
        plannedOutboundDate: draftPlannedOutboundDate || null,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setIsEditing(false)
      toast.success('출고작업 이름과 날짜를 수정했습니다.')
      router.refresh()
    })
  }

  function deleteShipment() {
    if (!selectedShipment) return
    if (!window.confirm(`“${shipmentDisplayName(selectedShipment)}” 출고작업을 정말 삭제할까요?\n예약 재고와 박스·파렛트·적재 기록도 함께 삭제되며 되돌릴 수 없습니다.`)) return
    startTransition(async () => {
      const result = await deleteChinaOutboundShipmentAction({ shipmentId: selectedShipment.id })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('출고작업을 삭제하고 예약 재고를 되돌렸습니다.')
      window.location.replace('/purchasing/china-shipments')
    })
  }

  return (
    <section className="rounded-md border bg-card p-3" aria-busy={isPending}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-3">
          <span className="text-xs font-medium text-muted-foreground">중국출고요청 선택</span>
          <select value={selectedShipment?.id ?? ''} onChange={(event) => event.target.value && onSelect(event.target.value)} className={inputClass} disabled={isPending}>
            <option value="">{activeShipments.length === 0 ? '등록된 중국출고요청이 없습니다.' : '중국출고요청을 선택해주세요.'}</option>
            {activeShipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipmentDisplayName(shipment)} · {shipment.plannedOutboundDate || '출고예정일 미입력'} · {statusLabels[shipment.status] ?? shipment.status}</option>)}
          </select>
        </label>
        <button type="button" disabled={isPending} onClick={onToggleCreate} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60">
          <PackagePlus className="size-4" />{showCreate ? '요청 닫기' : '새 중국출고요청'}
        </button>
        {selectedShipment ? <div className="flex shrink-0 gap-2">
          <button type="button" disabled={isPending} onClick={() => setIsEditing((open) => !open)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60 sm:flex-none">{isEditing ? '수정 닫기' : '이름·날짜 수정'}</button>
          <button type="button" disabled={isPending || selectedShipment.status === 'dispatched'} onClick={deleteShipment} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"><Trash2 className="size-4" /> 삭제</button>
        </div> : null}
      </div>
      {isEditing && selectedShipment ? <form onSubmit={saveShipmentDetails} className="mt-3 grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <Field label="출고작업명"><input value={draftDisplayName} onChange={(event) => setDraftDisplayName(event.target.value)} className={inputClass} placeholder="예: 2026-10-01 중국출고" /></Field>
        <Field label="출고예정일"><input type="date" value={draftPlannedOutboundDate} onChange={(event) => setDraftPlannedOutboundDate(event.target.value)} className={inputClass} /></Field>
        <div className="flex gap-2 sm:justify-end"><button type="button" disabled={isPending} onClick={() => { setDraftDisplayName(selectedShipment.displayName ?? defaultShipmentDisplayName(selectedShipment.plannedOutboundDate)); setDraftPlannedOutboundDate(selectedShipment.plannedOutboundDate ?? ''); setIsEditing(false) }} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-60">취소</button><button type="submit" disabled={isPending} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 저장</button></div>
      </form> : null}
      {shipments.length !== activeShipments.length ? <p className="mt-2 text-xs text-muted-foreground">취소된 출고작업 {(shipments.length - activeShipments.length).toLocaleString('ko-KR')}건은 목록에서 숨겼습니다.</p> : null}
    </section>
  )
}

function ShipmentDetailPanel({ detail, inventoryItems, stage, isPending, startTransition, onStageChange }: {
  detail: ChinaShipmentDetailView | null
  inventoryItems: ChinaShipmentStockItem[]
  stage: ChinaShipmentStage
  isPending: boolean
  startTransition: ReturnType<typeof useTransition>[1]
  onStageChange: (stage: ChinaShipmentStage) => void
}) {
  const router = useRouter()
  const [boxPage, setBoxPage] = useState(1)

  if (!detail) return null

  const { shipment, items, pallets, boxes, boxItems } = detail
  const editable = editableStatuses.has(shipment.status)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const boxById = new Map(boxes.map((box) => [box.id, box]))
  const palletById = new Map(pallets.map((pallet) => [pallet.id, pallet]))
  const boxItemsByItem = new Map(items.map((item) => [item.id, boxItems.filter((boxItem) => boxItem.shipmentItemId === item.id)]))
  const boxItemsByBox = new Map(boxes.map((box) => [box.id, boxItems.filter((boxItem) => boxItem.boxId === box.id)]))
  const totalOutboundQuantity = items.reduce((total, item) => total + item.reservedQuantity, 0)
  const totalPackedQuantity = items.reduce((total, item) => total + item.packedQuantity, 0)
  const boxesWithItems = boxes.filter((box) => (boxItemsByBox.get(box.id)?.length ?? 0) > 0)
  const palletSummaries = buildPalletSummaries({ pallets, boxes: boxesWithItems, boxItemsByBox, itemById, palletById })
  const sortedBoxSplitItems = [...items].sort((left, right) => {
    const leftComplete = left.packedQuantity === left.reservedQuantity
    const rightComplete = right.packedQuantity === right.reservedQuantity
    if (leftComplete !== rightComplete) return leftComplete ? 1 : -1
    return compareShipmentItems(left, right)
  })
  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(sortedBoxSplitItems.length / pageSize))
  const resolvedBoxPage = Math.min(boxPage, pageCount)
  const pagedBoxSplitItems = sortedBoxSplitItems.slice((resolvedBoxPage - 1) * pageSize, resolvedBoxPage * pageSize)

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string, afterSuccess?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? '처리하지 못했습니다.')
        return
      }
      afterSuccess?.()
      toast.success(successMessage)
      router.refresh()
    })
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{shipmentDisplayName(shipment)}</h2><StatusBadge status={shipment.status} /></div>
          <p className="mt-1 text-sm text-muted-foreground">출고예정일: {shipment.plannedOutboundDate || '미입력'} · 출고 창고: {shipment.originWarehouseCode} · 도착지: {shipment.destinationName || '미입력'}</p>
          <p className="mt-1 text-xs text-muted-foreground">작업번호: {shipment.shipmentNo} · 상품 {items.length.toLocaleString('ko-KR')}종 · 출고 {totalOutboundQuantity.toLocaleString('ko-KR')}개 · 박스분할 {totalPackedQuantity.toLocaleString('ko-KR')}개</p>
          {shipment.memo ? <p className="mt-1 text-xs text-muted-foreground">메모: {shipment.memo}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {stage === 'summary' ? <a href={`/api/purchasing/china-shipments/${encodeURIComponent(shipment.id)}/export`} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"><Download className="size-4" /> 최종 엑셀 다운로드</a> : null}
          {editable && stage === 'summary' ? <button type="button" disabled={isPending} onClick={() => run(() => markChinaOutboundShipmentReadyAction({ shipmentId: shipment.id }), '포장완료로 전환했습니다.')} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"><Check className="size-4" /> 포장완료</button> : null}
          {shipment.status === 'ready' ? <button type="button" disabled={isPending} onClick={() => { if (window.confirm('포장된 수량을 SaaS 중국재고에서 차감하고 출고완료 처리할까요?')) run(() => dispatchChinaOutboundShipmentAction({ shipmentId: shipment.id }), '출고완료 처리했습니다. SaaS 재고가 차감되었습니다.') }} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"><Send className="size-4" /> 출고완료</button> : null}
          {shipment.status !== 'dispatched' && shipment.status !== 'cancelled' ? <button type="button" disabled={isPending} onClick={() => { if (window.confirm('이 출고작업을 취소하고 예약 수량을 풀까요?')) run(() => cancelChinaOutboundShipmentAction({ shipmentId: shipment.id }), '출고작업을 취소하고 재고 예약을 풀었습니다.') }} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"><Trash2 className="size-4" /> 작업 취소</button> : null}
        </div>
      </div>

      <nav className="grid gap-2 rounded-lg border bg-muted/20 p-2 sm:grid-cols-4" aria-label="중국출고 작업 단계">
        <StageButton active={stage === 'items'} step="1단계" title="출고품목" detail={`${items.length.toLocaleString('ko-KR')}종 · ${totalOutboundQuantity.toLocaleString('ko-KR')}개`} onClick={() => onStageChange('items')} />
        <StageButton active={stage === 'boxes'} step="2단계" title="박스분할" detail={`${totalPackedQuantity.toLocaleString('ko-KR')} / ${totalOutboundQuantity.toLocaleString('ko-KR')}개`} onClick={() => onStageChange('boxes')} />
        <StageButton active={stage === 'pallets'} step="3단계" title="파렛트적재" detail={`사용 파렛트 ${palletSummaries.length.toLocaleString('ko-KR')}개`} onClick={() => onStageChange('pallets')} />
        <StageButton active={stage === 'summary'} step="4단계" title="최종 적재리스트" detail={`박스 ${boxesWithItems.length.toLocaleString('ko-KR')}개`} onClick={() => onStageChange('summary')} />
      </nav>

      {stage === 'items' ? <section className="space-y-3"><ShipmentItemAdditionPanel shipmentId={shipment.id} inventoryItems={inventoryItems} editable={editable} isPending={isPending} /><OutboundItemsPanel items={items} boxItemsByItem={boxItemsByItem} /></section> : null}

      {stage === 'boxes' ? <section className="space-y-4">
        <section className="rounded-lg border bg-muted/20 p-4">
          <h3 className="font-semibold">2단계 · 상품별 박스분할</h3>
          <p className="mt-1 text-sm text-muted-foreground">상품을 먼저 박스로 나누고, 박스별 수량과 가로·세로·높이를 입력하세요. 파렛트 번호는 다음 단계에서 적습니다.</p>
        </section>
        <WorkbookActions shipmentId={shipment.id} editable={editable} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground">진행 중인 품목을 먼저, 완료 품목을 마지막에 표시합니다. 품목코드는 오름차순으로 고정됩니다.</p>
          <Pagination page={resolvedBoxPage} pageCount={pageCount} onPrevious={() => setBoxPage((current) => Math.max(1, current - 1))} onNext={() => setBoxPage((current) => Math.min(pageCount, current + 1))} />
        </div>
        <div className="space-y-3">
          {pagedBoxSplitItems.map((item) => {
            const allocations = (boxItemsByItem.get(item.id) ?? []).flatMap((allocation) => {
              const box = boxById.get(allocation.boxId)
              return box ? [{ allocation, box }] : []
            })
            return <ProductBoxSplitEditor key={`${item.id}:${allocations.map(({ allocation }) => `${allocation.id}:${allocation.quantity}`).join('|')}`} item={item} allocations={allocations} editable={editable} isPending={isPending} onSave={(nextAllocations) => run(() => saveChinaOutboundItemBoxSplitsAction({ shipmentId: shipment.id, shipmentItemId: item.id, allocations: nextAllocations }), `${item.productName}의 박스분할을 저장했습니다.`)} />
          })}
        </div>
        <div className="flex justify-end"><Pagination page={resolvedBoxPage} pageCount={pageCount} onPrevious={() => setBoxPage((current) => Math.max(1, current - 1))} onNext={() => setBoxPage((current) => Math.min(pageCount, current + 1))} /></div>
      </section> : null}

      {stage === 'pallets' ? <section className="space-y-4">
        <section className="rounded-lg border bg-muted/20 p-4"><h3 className="font-semibold">3단계 · 파렛트적재</h3><p className="mt-1 text-sm text-muted-foreground">박스분할을 마친 박스에 실제 사용한 파렛트 번호를 직접 적으세요. 입력한 번호만 누적되어 총 파렛트 수와 파렛트별 CBM이 계산됩니다.</p></section>
        <WorkbookActions shipmentId={shipment.id} editable={editable} />
        {boxesWithItems.length === 0 ? <EmptyStage title="먼저 박스분할을 저장해주세요." description="박스에 상품이 담긴 뒤 파렛트 번호를 입력할 수 있습니다." onMove={() => onStageChange('boxes')} moveLabel="2단계로 이동" /> : <PalletAssignmentPanel boxes={boxesWithItems} boxItemsByBox={boxItemsByBox} itemById={itemById} palletById={palletById} editable={editable} isPending={isPending} onSave={(assignments) => run(() => assignChinaOutboundBoxesToPalletsAction({ shipmentId: shipment.id, assignments }), '파렛트 적재를 저장했습니다.')} />}
        <PalletSummaryCards summaries={palletSummaries} />
      </section> : null}

      {stage === 'summary' ? <section className="space-y-4">
        <section className="rounded-lg border bg-muted/20 p-4"><h3 className="font-semibold">4단계 · 최종 파렛트 적재리스트</h3><p className="mt-1 text-sm text-muted-foreground">파렛트별로 어떤 박스와 상품이 실렸는지 확인합니다. 포장완료 후에는 수량과 파렛트 배정을 수정할 수 없습니다.</p></section>
        <WorkbookActions shipmentId={shipment.id} editable={editable} />
        {items.some((item) => item.packedQuantity !== item.reservedQuantity) ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">아직 박스분할이 끝나지 않은 품목이 있습니다. 모든 상품의 박스분할 수량이 출고수량과 같아야 포장완료할 수 있습니다.</p> : null}
        {boxesWithItems.some((box) => !box.palletId) ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">파렛트 번호가 비어 있는 박스가 있습니다. 적재된 모든 박스에 파렛트 번호를 입력해주세요.</p> : null}
        {palletSummaries.length > 0 ? <PalletSummaryCards summaries={palletSummaries} detailed /> : <EmptyStage title="파렛트에 적재된 박스가 없습니다." description="3단계에서 박스별 파렛트 번호를 입력하면 최종 적재리스트가 만들어집니다." onMove={() => onStageChange('pallets')} moveLabel="3단계로 이동" />}
      </section> : null}
    </section>
  )
}

function OutboundItemsPanel({ items, boxItemsByItem }: {
  items: ChinaShipmentDetailView['items']
  boxItemsByItem: Map<string, ChinaShipmentDetailView['boxItems']>
}) {
  const sortedItems = [...items].sort(compareShipmentItems)
  return <section className="overflow-hidden rounded-lg border"><div className="border-b bg-muted/20 px-4 py-3"><h3 className="font-semibold">1단계 · 출고품목 확인</h3><p className="mt-1 text-sm text-muted-foreground">추가 품목이나 추가 수량은 위의 품목 추가에서 넣을 수 있습니다. 이미 박스분할한 수량은 그대로 유지됩니다.</p></div><div className="overflow-x-auto"><table className="min-w-[760px] w-full text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">품목코드</th><th className="px-3 py-2 text-left font-medium">상품명</th><th className="px-3 py-2 text-left font-medium">옵션</th><th className="px-3 py-2 text-right font-medium">출고수량</th><th className="px-3 py-2 text-right font-medium">박스분할</th><th className="px-3 py-2 text-center font-medium">상태</th></tr></thead><tbody>{sortedItems.map((item) => <tr key={item.id} className="border-t"><td className="px-3 py-3 font-medium">{item.sku}</td><td className="px-3 py-3">{item.productName}</td><td className="px-3 py-3 text-muted-foreground">{item.optionName || '-'}</td><td className="px-3 py-3 text-right tabular-nums">{item.reservedQuantity.toLocaleString('ko-KR')}개</td><td className="px-3 py-3 text-right tabular-nums">{item.packedQuantity.toLocaleString('ko-KR')}개</td><td className="px-3 py-3 text-center"><ProgressBadge completed={item.packedQuantity === item.reservedQuantity} detail={`${(boxItemsByItem.get(item.id)?.length ?? 0).toLocaleString('ko-KR')}박스`} /></td></tr>)}</tbody></table></div></section>
}

function ShipmentItemAdditionPanel({ shipmentId, inventoryItems, editable, isPending }: {
  shipmentId: string
  inventoryItems: ChinaShipmentStockItem[]
  editable: boolean
  isPending: boolean
}) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isAdding, startAdding] = useTransition()
  const [search, setSearch] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const searchKeyword = search.trim().toLocaleLowerCase('ko-KR')
  const availableItems = inventoryItems
    .filter((item) => item.availableQuantity > 0)
    .filter((item) => !searchKeyword || [item.sku, item.productName, item.optionName ?? '', item.warehouseCode]
      .some((value) => value.toLocaleLowerCase('ko-KR').includes(searchKeyword)))
    .sort(compareShipmentItems)
  const additionalLines = inventoryItems.flatMap((item) => {
    const quantity = positiveInteger(quantities[item.id] ?? '')
    return quantity ? [{ inventoryId: item.id, quantity }] : []
  })
  const totalQuantity = additionalLines.reduce((total, line) => total + line.quantity, 0)
  const disabled = !editable || isPending || isAdding

  function addItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (additionalLines.length === 0) {
      toast.error('추가할 품목과 수량을 입력해주세요.')
      return
    }
    startAdding(async () => {
      const result = await addChinaOutboundShipmentItemsAction({ shipmentId, lines: additionalLines })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setQuantities({})
      setSearch('')
      setIsOpen(false)
      toast.success(`출고품목 ${additionalLines.length.toLocaleString('ko-KR')}종 · ${totalQuantity.toLocaleString('ko-KR')}개를 추가했습니다.`)
      router.refresh()
    })
  }

  return <section className="rounded-lg border bg-muted/20 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">출고품목 추가</h3><p className="mt-1 text-xs text-muted-foreground">선정 후에도 품목이나 추가 수량을 같은 중국출고작업에 예약할 수 있습니다.</p></div><button type="button" disabled={disabled} onClick={() => setIsOpen((open) => !open)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"><Plus className="size-3.5" /> {isOpen ? '추가 닫기' : '품목 추가'}</button></div>{!editable ? <p className="mt-3 text-xs text-muted-foreground">포장완료 또는 출고완료 상태에서는 출고품목을 추가할 수 없습니다.</p> : null}{isOpen ? <form onSubmit={addItems} className="mt-3 space-y-3 border-t pt-3"><input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} placeholder="상품명, 상품코드, 옵션, 창고 검색" disabled={disabled} /><div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">{availableItems.length === 0 ? <p className="rounded-md border border-dashed bg-background px-3 py-8 text-center text-sm text-muted-foreground">조건에 맞는 추가 가능 재고가 없습니다.</p> : availableItems.map((item) => <article key={item.id} className="rounded-md border bg-background p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">출고 창고: {item.warehouseCode}</p><p className="mt-1 truncate font-medium">{item.productName}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</p></div><div className="flex items-end gap-3"><p className="text-right text-xs font-medium text-emerald-700">추가 가능 {item.availableQuantity.toLocaleString('ko-KR')}개</p><label className="block"><span className="mb-1 block text-xs text-muted-foreground">추가 출고</span><input type="number" min="0" max={item.availableQuantity} step="1" value={quantities[item.id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="h-9 w-24 rounded-md border px-2 text-right text-sm tabular-nums" placeholder="0" disabled={disabled} /></label></div></div></article>)}</div><div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p className="text-xs text-muted-foreground">추가 예정: {additionalLines.length.toLocaleString('ko-KR')}개 품목 · {totalQuantity.toLocaleString('ko-KR')}개</p><div className="flex gap-2"><button type="button" disabled={disabled} onClick={() => { setQuantities({}); setSearch(''); setIsOpen(false) }} className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60">취소</button><button type="submit" disabled={disabled || additionalLines.length === 0} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isAdding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} 선택 품목 추가</button></div></div></form> : null}</section>
}

function ProductBoxSplitEditor({ item, allocations, editable, isPending, onSave }: {
  item: ChinaShipmentDetailView['items'][number]
  allocations: Array<{ allocation: ChinaShipmentDetailView['boxItems'][number]; box: ChinaShipmentDetailView['boxes'][number] }>
  editable: boolean
  isPending: boolean
  onSave: (allocations: Array<{ boxNo: string; quantity: number; lengthCm: number | null; widthCm: number | null; heightCm: number | null }>) => void
}) {
  const [drafts, setDrafts] = useState<BoxSplitDraft[]>(() => allocations.length > 0
    ? allocations.map(({ allocation, box }) => ({ key: allocation.id, boxNo: box.boxNo, quantity: String(allocation.quantity), lengthCm: box.lengthCm == null ? '' : String(box.lengthCm), widthCm: box.widthCm == null ? '' : String(box.widthCm), heightCm: box.heightCm == null ? '' : String(box.heightCm) }))
    : [createBoxSplitDraft(item.sku)])
  const splitQuantity = drafts.reduce((total, draft) => total + (positiveInteger(draft.quantity) ?? 0), 0)
  const isComplete = item.packedQuantity === item.reservedQuantity

  function patchDraft(key: string, patch: Partial<BoxSplitDraft>) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...patch } : draft))
  }

  function save() {
    const nextAllocations = drafts
      .filter((draft) => [draft.boxNo, draft.quantity, draft.lengthCm, draft.widthCm, draft.heightCm].some((value) => value.trim()))
      .map((draft) => ({
        boxNo: draft.boxNo.trim(),
        quantity: Number(draft.quantity),
        lengthCm: optionalNumber(draft.lengthCm),
        widthCm: optionalNumber(draft.widthCm),
        heightCm: optionalNumber(draft.heightCm),
      }))
    onSave(nextAllocations)
  }

  return <article className="overflow-hidden rounded-lg border bg-background"><div className="flex flex-col gap-2 border-b bg-muted/20 px-4 py-3 md:flex-row md:items-center md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.sku}</p><ProgressBadge completed={isComplete} detail={`${item.packedQuantity.toLocaleString('ko-KR')} / ${item.reservedQuantity.toLocaleString('ko-KR')}개`} /></div><p className="mt-1 truncate text-sm">{item.productName}{item.optionName ? ` · ${item.optionName}` : ''}</p></div><p className={`text-sm tabular-nums ${splitQuantity > item.reservedQuantity ? 'font-medium text-red-700' : 'text-muted-foreground'}`}>입력 중 {splitQuantity.toLocaleString('ko-KR')} / {item.reservedQuantity.toLocaleString('ko-KR')}개</p></div><div className="overflow-x-auto"><table className="min-w-[880px] w-full text-sm"><thead className="bg-muted/10 text-xs text-muted-foreground"><tr><th className="w-[22%] px-3 py-2 text-left font-medium">박스번호</th><th className="w-[14%] px-3 py-2 text-right font-medium">적재수량</th><th className="w-[13%] px-3 py-2 text-right font-medium">가로(cm)</th><th className="w-[13%] px-3 py-2 text-right font-medium">세로(cm)</th><th className="w-[13%] px-3 py-2 text-right font-medium">높이(cm)</th><th className="w-[15%] px-3 py-2 text-right font-medium">CBM</th><th className="w-[10%] px-3 py-2 text-center font-medium">관리</th></tr></thead><tbody>{drafts.map((draft) => { const cbm = calculateChinaOutboundBoxCbm({ lengthCm: optionalNumber(draft.lengthCm), widthCm: optionalNumber(draft.widthCm), heightCm: optionalNumber(draft.heightCm) }); return <tr key={draft.key} className="border-t"><td className="px-3 py-2"><input value={draft.boxNo} onChange={(event) => patchDraft(draft.key, { boxNo: event.target.value })} disabled={!editable || isPending} className={compactInputClass} placeholder="예: A-01" /></td><td className="px-3 py-2"><input type="number" min="1" step="1" value={draft.quantity} onChange={(event) => patchDraft(draft.key, { quantity: event.target.value })} disabled={!editable || isPending} className={`${compactInputClass} text-right tabular-nums`} placeholder="0" /></td><td className="px-3 py-2"><input type="number" min="0" step="0.01" value={draft.lengthCm} onChange={(event) => patchDraft(draft.key, { lengthCm: event.target.value })} disabled={!editable || isPending} className={`${compactInputClass} text-right tabular-nums`} placeholder="선택" /></td><td className="px-3 py-2"><input type="number" min="0" step="0.01" value={draft.widthCm} onChange={(event) => patchDraft(draft.key, { widthCm: event.target.value })} disabled={!editable || isPending} className={`${compactInputClass} text-right tabular-nums`} placeholder="선택" /></td><td className="px-3 py-2"><input type="number" min="0" step="0.01" value={draft.heightCm} onChange={(event) => patchDraft(draft.key, { heightCm: event.target.value })} disabled={!editable || isPending} className={`${compactInputClass} text-right tabular-nums`} placeholder="선택" /></td><td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatChinaOutboundCbm(cbm) ?? '-'}</td><td className="px-3 py-2 text-center"><button type="button" disabled={!editable || isPending || drafts.length === 1} onClick={() => setDrafts((current) => current.filter((candidate) => candidate.key !== draft.key))} className="h-8 rounded-md border border-red-200 px-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40">삭제</button></td></tr> })}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-4 py-3"><p className="text-xs text-muted-foreground">규격은 가로·세로·높이를 모두 입력하면 CBM이 자동 계산됩니다. 한 박스에 여러 품목을 담으려면 같은 박스번호를 입력하세요.</p><div className="flex gap-2"><button type="button" disabled={!editable || isPending} onClick={() => setDrafts((current) => [...current, createBoxSplitDraft(item.sku, current.length + 1)])} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"><Plus className="size-3.5" /> 박스 추가</button><button type="button" disabled={!editable || isPending} onClick={save} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} 박스분할 저장</button></div></div></article>
}

function PalletAssignmentPanel({ boxes, boxItemsByBox, itemById, palletById, editable, isPending, onSave }: {
  boxes: ChinaShipmentDetailView['boxes']
  boxItemsByBox: Map<string, ChinaShipmentDetailView['boxItems']>
  itemById: Map<string, ChinaShipmentDetailView['items'][number]>
  palletById: Map<string, ChinaShipmentDetailView['pallets'][number]>
  editable: boolean
  isPending: boolean
  onSave: (assignments: Array<{ boxNo: string; palletNo: string | null }>) => void
}) {
  const sortedBoxes = [...boxes].sort((left, right) => left.boxNo.localeCompare(right.boxNo, 'ko-KR', { numeric: true }))
  const [palletNumbers, setPalletNumbers] = useState<Record<string, string>>(() => Object.fromEntries(sortedBoxes.map((box) => [box.boxNo, box.palletId ? palletById.get(box.palletId)?.palletNo ?? '' : ''])))

  return <section className="overflow-hidden rounded-lg border"><div className="overflow-x-auto"><table className="min-w-[850px] w-full text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">박스번호</th><th className="px-3 py-2 text-left font-medium">적재 상품</th><th className="px-3 py-2 text-right font-medium">적재수량</th><th className="px-3 py-2 text-right font-medium">박스 규격</th><th className="px-3 py-2 text-right font-medium">CBM</th><th className="px-3 py-2 text-center font-medium">파렛트번호</th></tr></thead><tbody>{sortedBoxes.map((box) => { const boxItems = boxItemsByBox.get(box.id) ?? []; const quantity = boxItems.reduce((total, item) => total + item.quantity, 0); const products = boxItems.map((boxItem) => { const item = itemById.get(boxItem.shipmentItemId); return item ? `${item.sku} ${item.productName}${item.optionName ? ` · ${item.optionName}` : ''} (${boxItem.quantity.toLocaleString('ko-KR')}개)` : '' }).filter(Boolean); const cbm = calculateChinaOutboundBoxCbm(box); return <tr key={box.id} className="border-t align-top"><td className="px-3 py-3 font-medium">{box.boxNo}</td><td className="px-3 py-3 text-xs leading-5">{products.join('\n')}</td><td className="px-3 py-3 text-right tabular-nums">{quantity.toLocaleString('ko-KR')}개</td><td className="px-3 py-3 text-right text-xs text-muted-foreground">{formatChinaOutboundBoxDimensions(box) ?? '미입력'}</td><td className="px-3 py-3 text-right tabular-nums">{formatChinaOutboundCbm(cbm) ?? '-'}</td><td className="px-3 py-2"><input value={palletNumbers[box.boxNo] ?? ''} onChange={(event) => setPalletNumbers((current) => ({ ...current, [box.boxNo]: event.target.value }))} disabled={!editable || isPending} className={`${compactInputClass} mx-auto max-w-32 text-center`} placeholder="예: 1" /></td></tr> })}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-4 py-3"><p className="text-xs text-muted-foreground">빈칸으로 저장하면 파렛트 배정을 해제합니다. 파렛트 번호는 숫자뿐 아니라 `A`, `B`, `1-2`처럼 자유롭게 입력할 수 있습니다.</p><button type="button" disabled={!editable || isPending} onClick={() => onSave(sortedBoxes.map((box) => ({ boxNo: box.boxNo, palletNo: palletNumbers[box.boxNo]?.trim() || null })))} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} 파렛트 적재 저장</button></div></section>
}

function WorkbookActions({ shipmentId, editable }: { shipmentId: string; editable: boolean }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<WorkbookPreview | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  async function uploadWorkbook(mode: 'preview' | 'apply') {
    if (!selectedFile) return toast.error('업로드할 엑셀 파일을 선택해주세요.')
    setIsWorking(true)
    try {
      const form = new FormData()
      form.set('file', selectedFile)
      form.set('mode', mode)
      const response = await fetch(`/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/workbook`, { method: 'POST', body: form })
      const body = await response.json().catch(() => ({})) as { error?: string; preview?: WorkbookPreview }
      if (body.preview) setPreview(body.preview)
      if (!response.ok) {
        toast.error(body.error ?? '엑셀을 확인하지 못했습니다.')
        return
      }
      if (mode === 'preview') {
        toast.success(body.preview?.errors.length ? '엑셀에서 확인할 항목을 찾았습니다.' : '엑셀 검토가 끝났습니다. 반영할 수 있습니다.')
      } else {
        toast.success('엑셀 작업 내용을 반영했습니다.')
        setSelectedFile(null)
        setPreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        router.refresh()
      }
    } catch {
      toast.error('엑셀 업로드 중 연결 오류가 발생했습니다.')
    } finally {
      setIsWorking(false)
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0] ?? null)
    setPreview(null)
  }

  return <section className="rounded-lg border border-dashed bg-muted/10 p-3"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><FileSpreadsheet className="size-4 text-emerald-700" /><h3 className="text-sm font-semibold">엑셀로 작업</h3></div><p className="mt-1 text-xs text-muted-foreground">현재 박스분할·파렛트적재 내용을 내려받아 엑셀에서 수정한 뒤 다시 검토하고 반영할 수 있습니다.</p></div><div className="flex flex-wrap items-center gap-2"><a href={`/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/workbook`} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted"><Download className="size-3.5" /> 작업용 엑셀</a><label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted ${!editable ? 'pointer-events-none opacity-50' : ''}`}><Upload className="size-3.5" /> {selectedFile ? selectedFile.name : '엑셀 선택'}<input ref={fileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} disabled={!editable || isWorking} className="sr-only" /></label><button type="button" disabled={!editable || isWorking || !selectedFile} onClick={() => uploadWorkbook('preview')} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">{isWorking ? <Loader2 className="size-3.5 animate-spin" /> : <FileSpreadsheet className="size-3.5" />} 엑셀 검토</button></div></div>{preview ? <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${preview.errors.length ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}><div className="flex flex-wrap items-center justify-between gap-2"><p>박스분할 {preview.summary.boxSplitItemCount.toLocaleString('ko-KR')}개 품목 · {preview.summary.boxSplitRowCount.toLocaleString('ko-KR')}개 행 · 파렛트 배정 {preview.summary.palletAssignmentCount.toLocaleString('ko-KR')}건</p>{preview.errors.length === 0 ? <button type="button" disabled={!editable || isWorking || !selectedFile} onClick={() => uploadWorkbook('apply')} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isWorking ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} 검토 결과 반영</button> : null}</div>{preview.errors.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-4">{preview.errors.slice(0, 10).map((error, index) => <li key={`${error.sheet}:${error.row}:${index}`}>{error.sheet}{error.row ? ` ${error.row}행` : ''}: {error.message}</li>)}{preview.errors.length > 10 ? <li>외 {preview.errors.length - 10}건</li> : null}</ul> : null}</div> : null}</section>
}

type PalletSummary = {
  palletNo: string
  boxes: ChinaShipmentDetailView['boxes']
  quantity: number
  cbm: number
  boxesWithoutDimensions: number
  products: Array<{ sku: string; productName: string; optionName: string | null; quantity: number }>
}

function buildPalletSummaries({ pallets, boxes, boxItemsByBox, itemById, palletById }: {
  pallets: ChinaShipmentDetailView['pallets']
  boxes: ChinaShipmentDetailView['boxes']
  boxItemsByBox: Map<string, ChinaShipmentDetailView['boxItems']>
  itemById: Map<string, ChinaShipmentDetailView['items'][number]>
  palletById: Map<string, ChinaShipmentDetailView['pallets'][number]>
}): PalletSummary[] {
  void pallets
  const grouped = new Map<string, ChinaShipmentDetailView['boxes']>()
  for (const box of boxes) {
    const pallet = box.palletId ? palletById.get(box.palletId) : null
    if (!pallet) continue
    grouped.set(pallet.palletNo, [...(grouped.get(pallet.palletNo) ?? []), box])
  }
  return [...grouped.entries()].map(([palletNo, palletBoxes]) => {
    const products = new Map<string, { sku: string; productName: string; optionName: string | null; quantity: number }>()
    let quantity = 0
    let cbm = 0
    let boxesWithoutDimensions = 0
    for (const box of palletBoxes) {
      const boxCbm = calculateChinaOutboundBoxCbm(box)
      if (boxCbm == null) boxesWithoutDimensions += 1
      else cbm += boxCbm
      for (const allocation of boxItemsByBox.get(box.id) ?? []) {
        const item = itemById.get(allocation.shipmentItemId)
        if (!item) continue
        quantity += allocation.quantity
        const key = `${item.sku}\u0000${item.optionName ?? ''}`
        const current = products.get(key)
        products.set(key, { sku: item.sku, productName: item.productName, optionName: item.optionName, quantity: (current?.quantity ?? 0) + allocation.quantity })
      }
    }
    return { palletNo, boxes: palletBoxes.sort((left, right) => left.boxNo.localeCompare(right.boxNo, 'ko-KR', { numeric: true })), quantity, cbm, boxesWithoutDimensions, products: [...products.values()].sort(compareShipmentItems) }
  }).sort((left, right) => left.palletNo.localeCompare(right.palletNo, 'ko-KR', { numeric: true }))
}

function PalletSummaryCards({ summaries, detailed = false }: { summaries: PalletSummary[]; detailed?: boolean }) {
  if (summaries.length === 0) return null
  return <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">사용 파렛트</h3><p className="mt-1 text-xs text-muted-foreground">실제로 박스가 배정된 파렛트만 집계합니다.</p></div><p className="text-sm font-medium">총 {summaries.length.toLocaleString('ko-KR')}파렛트</p></div><div className="grid gap-3 lg:grid-cols-2">{summaries.map((summary) => <article key={summary.palletNo} className="rounded-lg border bg-background p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">파렛트 {summary.palletNo}</p><p className="mt-1 text-xs text-muted-foreground">박스 {summary.boxes.length.toLocaleString('ko-KR')}개 · 상품 {summary.quantity.toLocaleString('ko-KR')}개</p></div><p className="text-right text-sm font-semibold tabular-nums">{formatChinaOutboundCbm(summary.cbm) ?? '0.0000'} CBM</p></div>{summary.boxesWithoutDimensions > 0 ? <p className="mt-2 text-xs text-amber-700">규격 미입력 박스 {summary.boxesWithoutDimensions.toLocaleString('ko-KR')}개는 CBM 합계에서 제외되었습니다.</p> : null}{detailed ? <div className="mt-3 space-y-2 border-t pt-3 text-xs"><p className="font-medium text-muted-foreground">적재 박스: {summary.boxes.map((box) => box.boxNo).join(', ')}</p><ul className="space-y-1">{summary.products.map((product) => <li key={`${product.sku}:${product.optionName ?? ''}`}>{product.sku} · {product.productName}{product.optionName ? ` · ${product.optionName}` : ''} <span className="tabular-nums text-muted-foreground">{product.quantity.toLocaleString('ko-KR')}개</span></li>)}</ul></div> : null}</article>)}</div></section>
}

function EmptyStage({ title, description, onMove, moveLabel }: { title: string; description: string; onMove: () => void; moveLabel: string }) {
  return <section className="rounded-lg border border-dashed p-8 text-center"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p><button type="button" onClick={onMove} className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">{moveLabel}</button></section>
}

function StageButton({ active, step, title, detail, onClick }: { active: boolean; step: string; title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-md border px-3 py-2.5 text-left transition-colors ${active ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-transparent bg-background hover:border-border hover:bg-muted'}`}><p className={`text-xs ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{step}</p><p className="mt-0.5 text-sm font-semibold">{title}</p><p className={`mt-1 text-xs ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{detail}</p></button>
}

function ProgressBadge({ completed, detail }: { completed: boolean; detail: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${completed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{completed ? '완료' : '진행'} · {detail}</span>
}

function StatusBadge({ status }: { status: string }) {
  const className = status === 'dispatched' ? 'bg-emerald-100 text-emerald-800' : status === 'ready' ? 'bg-sky-100 text-sky-800' : status === 'cancelled' ? 'bg-zinc-100 text-zinc-700' : 'bg-amber-100 text-amber-800'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{statusLabels[status] ?? status}</span>
}

function Pagination({ page, pageCount, onPrevious, onNext }: { page: number; pageCount: number; onPrevious: () => void; onNext: () => void }) {
  return <div className="flex items-center gap-2 text-sm"><button type="button" disabled={page <= 1} onClick={onPrevious} className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40" aria-label="이전 페이지"><ChevronLeft className="size-4" /></button><span className="min-w-16 text-center tabular-nums">{page} / {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={onNext} className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40" aria-label="다음 페이지"><ChevronRight className="size-4" /></button></div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
}

function shipmentHref(id: string, stage: ChinaShipmentStage) {
  return `/purchasing/china-shipments?shipment=${encodeURIComponent(id)}&step=${stage}`
}

function shipmentDisplayName(shipment: Pick<ChinaShipmentListItem, 'displayName' | 'shipmentNo'> | ChinaShipmentDetailView['shipment']) {
  return shipment.displayName?.trim() || shipment.shipmentNo
}

function defaultShipmentDisplayName(date: string | null | undefined) {
  return date ? `${date} 중국출고` : '중국출고'
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function createBoxSplitDraft(sku: string, order = 1): BoxSplitDraft {
  return { key: `${sku}-${Date.now()}-${Math.random()}`, boxNo: `${sku}-${order}`, quantity: '', lengthCm: '', widthCm: '', heightCm: '' }
}

function optionalNumber(value: string) {
  const normalized = value.trim()
  return normalized ? Number(normalized) : null
}

function positiveInteger(value: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function compareShipmentItems(
  left: Pick<ChinaShipmentDetailView['items'][number], 'sku' | 'productName'>,
  right: Pick<ChinaShipmentDetailView['items'][number], 'sku' | 'productName'>,
) {
  return left.sku.localeCompare(right.sku, 'ko-KR', { numeric: true })
    || left.productName.localeCompare(right.productName, 'ko-KR')
}
