'use client'

import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState, useTransition } from 'react'
import { nextAvailableBoxNumbers, planAutomaticBoxSplit, type InspectionPackingPiece } from '@/lib/purchasing/china-outbound-auto-packing'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, PackagePlus, Plus, Printer, Send, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundBoxDimensions, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { CHINA_OUTBOUND_DESTINATIONS } from '@/lib/purchasing/china-outbound-destinations'
import { useChinaWorkNavigation } from './china-work-navigation'
import { PurchasingProductImageButton } from '@/components/purchasing-product-image'
import type { ProductImageResult } from '@/lib/purchasing/product-image-catalogue'
import { TitleHelp } from './title-help'
import { ChineseNameEditor, MergeBoxesButton } from './outbound-package-editors'
import { matchesChinaStockPeriod, chinaStockDate } from '@/lib/purchasing/china-outbound-packaging'
import { ManualSamplePanel } from './manual-sample-panel'
import { PalletContentsPanel } from './pallet-contents-panel'
import { SavedBoxContentsPanel } from './saved-box-contents-panel'
import { ChinaShipmentExcelDialog } from './china-shipment-excel-dialog'
import { ChinaImportDocumentDialog } from './china-import-document-dialog'
import { ChinaShipmentWarehouseDialog, type ChinaOutboundWarehouseView } from './china-shipment-warehouse-dialog'
import { ChinaWorkGuardProvider, useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import {
  addChinaOutboundShipmentItemsAction,
  assignChinaOutboundBoxesToPalletsAction,
  createChinaOutboundShipmentAction,
  deleteChinaOutboundShipmentAction,
  dispatchChinaOutboundShipmentAction,
  saveChinaOutboundItemBoxSplitsAction,
  updateChinaOutboundShipmentAction,
} from '../saas-china-actions'

export type ChinaShipmentStockItem = {
  chineseProductName?: string
  lastReceivedAt?: string | null
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
    chineseProductName?: string | null
    itemCategory?: string | null
    warehouseCode: string
    sku: string
    productName: string
    optionName: string | null
    reservedQuantity: number
    packedQuantity: number
    dispatchedQuantity: number
    boxSplitStatus: 'in_progress' | 'completed'
    onHandQuantity?: number | null
    availableQuantity?: number | null
    receiptPacking?: InspectionPackingPiece[]
    productImage?: ProductImageResult
  }>
  pallets: Array<{ id: string; palletNo: string; note: string | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; grossWeightKg?: number | null; completionStatus?: 'in_progress' | 'completed' | null }>
  boxes: Array<{
    id: string
    shipmentId: string
    editable: boolean
    palletId: string | null
    boxNo: string
    status: string
    completionStatus?: 'in_progress' | 'completed' | null
    note: string | null
    lengthCm: number | null
    widthCm: number | null
    heightCm: number | null
    grossWeightKg?: number | null
  }>
  boxItems: Array<{ id: string; boxId: string; shipmentItemId: string; quantity: number }>
}

type BoxSplitDraft = { key: string; boxNo: string; quantity: string; lengthCm: string; widthCm: string; heightCm: string; boxId?: string; autoNumber?: boolean }
type BoxSplitStatus = 'in_progress' | 'completed'
type BoxSplitDraftSnapshot = {
  drafts: BoxSplitDraft[]
  baseline: BoxSplitDraft[]
  status?: BoxSplitStatus
  baselineStatus?: BoxSplitStatus
}
type BoxSplitItemFilter = 'all' | 'incomplete' | 'complete'
type SavedBoxFilter = 'all' | 'saved'
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

export function ChinaShipmentsBoard(props: {
  inventoryItems: ChinaShipmentStockItem[]
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView | null
  selectedStep: ChinaShipmentStage
  showCreate: boolean
  outboundWarehouses?: ChinaOutboundWarehouseView[]
}) {
  return <ChinaWorkGuardProvider key={props.showCreate ? 'create' : props.selectedShipment?.shipment.id ?? 'list'}><ChinaShipmentsBoardContent {...props} /></ChinaWorkGuardProvider>
}

function ChinaShipmentsBoardContent({
  inventoryItems,
  shipments,
  selectedShipment,
  selectedStep,
  showCreate,
  outboundWarehouses = [],
}: {
  inventoryItems: ChinaShipmentStockItem[]
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView | null
  selectedStep: ChinaShipmentStage
  showCreate: boolean
  outboundWarehouses?: ChinaOutboundWarehouseView[]
}) {
  const guard = useChinaWorkGuard()
  const navigateChinaWork = useChinaWorkNavigation()
  const searchParams = useSearchParams()
  const stepParam = searchParams.get('step')
  const activeStep = stepParam === 'items' || stepParam === 'boxes' || stepParam === 'pallets' || stepParam === 'summary'
    ? stepParam : selectedStep
  const [isPending, startTransition] = useTransition()
  const [initialDate] = useState(() => today())
  const createdShipmentId = useRef<string | null>(null)
  const creationMayExist = useRef(false)
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

  const isCreateDirty = showCreate && (selectedWarehouseCodes.length > 0 || Object.values(quantities).some((value) => value.trim() !== '') || destinationName !== '' || plannedOutboundDate !== initialDate || displayName !== defaultShipmentDisplayName(initialDate) || memo !== '')

  async function saveNewShipment() {
      if (creationMayExist.current) {
        toast.error('요청이 이미 생성됐을 수 있습니다. 목록을 먼저 확인한 뒤 다시 시도해주세요.')
        return false
      }
      if (!destinationName || Object.values(quantities).some((value) => value.trim() !== '' && !positiveInteger(value))) {
        toast.error('도착지와 올바른 출고수량을 입력한 뒤 저장해주세요.')
        return false
      }
      let result: Awaited<ReturnType<typeof createChinaOutboundShipmentAction>>
      try { result = await createChinaOutboundShipmentAction({
        displayName,
        destinationName,
        plannedOutboundDate: plannedOutboundDate || null,
        memo,
        lines: stagedShipmentLines,
      }) } catch {
        creationMayExist.current = true
        toast.error('응답이 끊겼지만 요청이 생성됐을 수 있습니다. 중복 생성을 막기 위해 목록을 먼저 확인해주세요.')
        return false
      }
      if (!result.ok) {
        toast.error(result.error)
        return false
      }
      if (!result.shipmentId) {
        creationMayExist.current = true
        toast.error('요청이 생성됐을 수 있지만 열지 못했습니다. 중복 생성을 막기 위해 목록을 먼저 확인해주세요.')
        return false
      }

      createdShipmentId.current = result.shipmentId
      toast.success('중국출고요청을 만들었습니다.')
      guard.setDraft('new-shipment', null)
      setQuantities({})
      setSelectedWarehouseCodes([])
      setDestinationName('')
      const nextDate = initialDate
      setPlannedOutboundDate(nextDate)
      setDisplayName(defaultShipmentDisplayName(nextDate))
      setDisplayNameIsDateDefault(true)
      setMemo('')
      return true
  }

  useChinaWorkDraft('new-shipment', isCreateDirty ? {
    kind: 'create', label: '새 출고요청', snapshot: null, save: saveNewShipment,
    discard: () => { setQuantities({}); setSelectedWarehouseCodes([]); setDestinationName(''); setPlannedOutboundDate(initialDate); setDisplayName(defaultShipmentDisplayName(initialDate)); setDisplayNameIsDateDefault(true); setMemo('') },
  } : null)

  function createShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      if (await guard.runTask(saveNewShipment) && createdShipmentId.current) navigateChinaWork(shipmentHref(createdShipmentId.current, 'items'))
    })
  }

  return (
    <fieldset data-purchasing-translate disabled={isPending || guard.busy} className="min-w-0 space-y-4 border-0 p-0" aria-busy={isPending || guard.busy}>
      <div className="space-y-3">
        <ShipmentSelector
          key={`selector:${showCreate ? 'new-shipment' : selectedShipment?.shipment.id ?? 'no-shipment'}`}
          shipments={shipments}
          selectedShipment={showCreate ? null : selectedShipment?.shipment ?? null}
          showCreate={showCreate}
          outboundWarehouses={outboundWarehouses}
          onToggleCreate={() => guard.requestNavigation(() => navigateChinaWork(showCreate ? '/purchasing/china-shipments' : '/purchasing/china-shipments?create=1'))}
          onSelect={(id) => {
            if (id !== selectedShipment?.shipment.id) guard.requestNavigation(() => navigateChinaWork(shipmentHref(id, 'items')))
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
                  <h3 className="text-sm font-semibold">출고 재고 위치<TitleHelp title="출고 재고 위치">여러 창고의 재고를 하나의 중국출고요청에 함께 넣을 수 있습니다.</TitleHelp></h3>
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
                  <h3 className="text-sm font-semibold">출고할 상품과 수량<TitleHelp title="출고할 상품과 수량">출고할 재고 위치를 하나 이상 체크해주세요.</TitleHelp></h3>
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
                            <p data-no-translate className="mt-1 truncate font-medium">{item.productName}</p>{item.chineseProductName && <p data-no-translate className="mt-1 text-sm text-muted-foreground">{item.chineseProductName}</p>}
                            <p data-no-translate className="mt-1 truncate text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</p>
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
            <div className="flex justify-end"><button type="submit" disabled={isPending || !destinationName} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 중국출고요청 만들기</button></div>
          </form>
          </section>
        ) : null}
        {!showCreate ? <ShipmentDetailPanel
          key={`detail:${selectedShipment?.shipment.id ?? 'no-shipment'}`}
          detail={selectedShipment}
          inventoryItems={inventoryItems}
          warehouseCodes={outboundWarehouses.map((warehouse) => warehouse.warehouseCode)}
          stage={activeStep}
          isPending={isPending || guard.busy}
          startTransition={startTransition}
          onStageChange={(stage) => selectedShipment && stage !== activeStep && guard.requestNavigation(() => {
            // All four stages use this shipment snapshot; switching stages needs no server request.
            window.history.replaceState(null, '', shipmentHref(selectedShipment.shipment.id, stage))
          })}
        /> : null}
      </div>
    </fieldset>
  )
}

function ShipmentSelector({ shipments, selectedShipment, showCreate, outboundWarehouses, onToggleCreate, onSelect }: {
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView['shipment'] | null
  showCreate: boolean
  outboundWarehouses: ChinaOutboundWarehouseView[]
  onToggleCreate: () => void
  onSelect: (id: string) => void
}) {
  const router = useRouter()
  const navigateChinaWork = useChinaWorkNavigation()
  const guard = useChinaWorkGuard()
  const [isPending, startTransition] = useTransition()
  const [isEditing, setIsEditing] = useState(false)
  const [draftDisplayName, setDraftDisplayName] = useState(() => selectedShipment?.displayName ?? defaultShipmentDisplayName(selectedShipment?.plannedOutboundDate ?? null))
  const [draftPlannedOutboundDate, setDraftPlannedOutboundDate] = useState(() => selectedShipment?.plannedOutboundDate ?? '')
  const [detailsBaseline, setDetailsBaseline] = useState(() => ({ displayName: selectedShipment?.displayName ?? defaultShipmentDisplayName(selectedShipment?.plannedOutboundDate ?? null), plannedOutboundDate: selectedShipment?.plannedOutboundDate ?? '' }))
  const visibleShipments = shipments.filter((shipment) => shipment.status !== 'cancelled')
  async function saveShipmentDetailsDraft() {
      if (!selectedShipment) return false
      const result = await updateChinaOutboundShipmentAction({
        shipmentId: selectedShipment.id,
        displayName: draftDisplayName.trim() || null,
        plannedOutboundDate: draftPlannedOutboundDate || null,
      })
      if (!result.ok) {
        toast.error(result.error)
        return false
      }
      setDetailsBaseline({ displayName: draftDisplayName, plannedOutboundDate: draftPlannedOutboundDate })
      guard.setDraft('shipment-details', null)
      setIsEditing(false)
      toast.success('출고작업 이름과 날짜를 수정했습니다.')
      router.refresh()
      return true
  }

  const detailsDirty = isEditing && (draftDisplayName !== detailsBaseline.displayName || draftPlannedOutboundDate !== detailsBaseline.plannedOutboundDate)
  useChinaWorkDraft('shipment-details', detailsDirty ? {
    kind: 'details', label: '출고작업 이름·날짜', snapshot: null, save: saveShipmentDetailsDraft,
    discard: () => { setDraftDisplayName(detailsBaseline.displayName); setDraftPlannedOutboundDate(detailsBaseline.plannedOutboundDate); setIsEditing(false) },
  } : null)

  function saveShipmentDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      await guard.runTask(saveShipmentDetailsDraft)
    })
  }

  function deleteShipment() {
    if (!selectedShipment) return
    guard.requestConfirmation({
      title: '출고작업 삭제',
      description: '이 출고작업을 삭제할까요? 예약 재고와 박스·파렛트·적재 기록도 함께 삭제되며 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      destructive: true,
      onConfirm: () => guard.requestNavigation(() => {
        startTransition(async () => { const deleted = await guard.runTask(async () => {
          const result = await deleteChinaOutboundShipmentAction({ shipmentId: selectedShipment.id })
          if (!result.ok) {
            toast.error(result.error)
            return false
          }
          toast.success('출고작업을 삭제하고 예약 재고를 되돌렸습니다.')
          return true
        })
        if (deleted) navigateChinaWork('/purchasing/china-shipments')
        })
      })
    })
  }

  return (
    <section className="rounded-md border bg-card p-3" aria-busy={isPending}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-3">
          <div className="flex items-center text-xs font-medium text-muted-foreground"><label htmlFor="china-shipment-selection">중국출고요청 선택</label><TitleHelp title="중국출고요청 선택">선택한 출고작업만 화면에 표시됩니다. 저장하지 않은 내용이 있으면 이동 전에 확인합니다.</TitleHelp></div>
          <select id="china-shipment-selection" value={selectedShipment?.id ?? ''} onChange={(event) => event.target.value && onSelect(event.target.value)} className={inputClass} disabled={isPending}>
            <option value="">{visibleShipments.length === 0 ? '등록된 중국출고요청이 없습니다.' : '중국출고요청을 선택해주세요.'}</option>
            {visibleShipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipmentDisplayName(shipment)} · {shipment.plannedOutboundDate || '출고예정일 미입력'} · {statusLabels[shipment.status] ?? shipment.status}</option>)}
          </select>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ChinaShipmentExcelDialog onApplied={(shipmentId) => {
            if (shipmentId) guard.requestNavigation(() => navigateChinaWork(shipmentHref(shipmentId, 'items')))
          }} />
          <ChinaShipmentWarehouseDialog warehouses={outboundWarehouses} />
          <button type="button" disabled={isPending} onClick={onToggleCreate} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"><PackagePlus className="size-4" /> {showCreate ? '요청 닫기' : '새 중국출고요청'}</button>
        </div>
        {selectedShipment ? <div className="flex shrink-0 gap-2">
          <button type="button" disabled={isPending} onClick={() => isEditing ? guard.requestNavigation(() => setIsEditing(false), ['details']) : setIsEditing(true)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60 sm:flex-none">{isEditing ? '수정 닫기' : '이름·날짜 수정'}</button>
          <button type="button" disabled={isPending || selectedShipment.status === 'dispatched'} onClick={deleteShipment} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"><Trash2 className="size-4" /> 삭제</button>
        </div> : null}
      </div>
      {isEditing && selectedShipment ? <form onSubmit={saveShipmentDetails} className="mt-3 grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <Field label="출고작업명"><input value={draftDisplayName} onChange={(event) => setDraftDisplayName(event.target.value)} className={inputClass} placeholder="예: 2026-10-01 중국출고" /></Field>
        <Field label="출고예정일"><input type="date" value={draftPlannedOutboundDate} onChange={(event) => setDraftPlannedOutboundDate(event.target.value)} className={inputClass} /></Field>
        <div className="flex gap-2 sm:justify-end"><button type="button" disabled={isPending} onClick={() => { setDraftDisplayName(selectedShipment.displayName ?? defaultShipmentDisplayName(selectedShipment.plannedOutboundDate)); setDraftPlannedOutboundDate(selectedShipment.plannedOutboundDate ?? ''); setIsEditing(false) }} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-60">취소</button><button type="submit" disabled={isPending} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 저장</button></div>
      </form> : null}
      {shipments.length !== visibleShipments.length ? <p className="mt-2 text-xs text-muted-foreground">취소된 출고작업 {(shipments.length - visibleShipments.length).toLocaleString('ko-KR')}건은 목록에서 숨겼습니다.</p> : null}
    </section>
  )
}

function ShipmentDetailPanel({ detail, inventoryItems, warehouseCodes, stage, isPending, startTransition, onStageChange }: {
  detail: ChinaShipmentDetailView | null
  inventoryItems: ChinaShipmentStockItem[]
  warehouseCodes: string[]
  stage: ChinaShipmentStage
  isPending: boolean
  startTransition: ReturnType<typeof useTransition>[1]
  onStageChange: (stage: ChinaShipmentStage) => void
}) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const [boxPage, setBoxPage] = useState(1)
  const [boxSplitItemFilter, setBoxSplitItemFilter] = useState<BoxSplitItemFilter>('all')
  const [savedBoxFilter, setSavedBoxFilter] = useState<SavedBoxFilter>('saved')
  const [selectedBoxItemIds, setSelectedBoxItemIds] = useState<string[]>([])
  const [editingBoxItemId, setEditingBoxItemId] = useState<string | null>(null)
  const [editorStage, setEditorStage] = useState(stage)
  if (editorStage !== stage) { setEditorStage(stage); setEditingBoxItemId(null) }

  if (!detail) return null

  const { shipment, items, pallets, boxes, boxItems } = detail
  const editable = editableStatuses.has(shipment.status)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const boxById = new Map(boxes.map((box) => [box.id, box]))
  const palletById = new Map(pallets.map((pallet) => [pallet.id, pallet]))
  const boxItemsByItem = new Map(items.map((item) => [item.id, [] as typeof boxItems]))
  const boxItemsByBox = new Map(boxes.map((box) => [box.id, [] as typeof boxItems]))
  for (const allocation of boxItems) {
    boxItemsByItem.get(allocation.shipmentItemId)?.push(allocation)
    boxItemsByBox.get(allocation.boxId)?.push(allocation)
  }
  const savedBoxSummaries = buildSavedBoxSummaries({ boxes, boxItemsByBox, itemById, palletById })
  const totalOutboundQuantity = items.reduce((total, item) => total + item.reservedQuantity, 0)
  const totalPackedQuantity = items.reduce((total, item) => total + item.packedQuantity, 0)
  const boxesWithItems = boxes.filter((box) => (boxItemsByBox.get(box.id)?.length ?? 0) > 0)
  const palletSummaries = buildPalletSummaries({ pallets, boxes: boxesWithItems, boxItemsByBox, itemById, palletById })
  const hasIncompleteBoxSplit = items.some((item) => item.packedQuantity !== item.reservedQuantity)
  const hasUnassignedPalletBox = boxesWithItems.some((box) => !box.palletId)
  const cannotDispatch = items.length === 0 || hasIncompleteBoxSplit || items.some((item) => (boxItemsByItem.get(item.id) ?? []).reduce((sum, allocation) => sum + allocation.quantity, 0) !== item.reservedQuantity)
  const canDownloadShipmentLabels = boxesWithItems.length > 0
  const canDownloadPalletLabels = boxesWithItems.some((box) => box.palletId && palletById.has(box.palletId))
  const shipmentLabelsHref = `/api/purchasing/china-shipments/${encodeURIComponent(shipment.id)}/labels`
  const sortedBoxSplitItems = [...items].sort((left, right) => {
    const leftComplete = left.packedQuantity === left.reservedQuantity
    const rightComplete = right.packedQuantity === right.reservedQuantity
    if (leftComplete !== rightComplete) return leftComplete ? 1 : -1
    return compareShipmentItems(left, right)
  })
  const incompleteBoxSplitItems = sortedBoxSplitItems.filter((item) => item.packedQuantity !== item.reservedQuantity)
  const completeBoxSplitItems = sortedBoxSplitItems.filter((item) => item.packedQuantity === item.reservedQuantity)
  const filteredBoxSplitItems = boxSplitItemFilter === 'incomplete'
    ? incompleteBoxSplitItems
    : boxSplitItemFilter === 'complete'
      ? completeBoxSplitItems
      : sortedBoxSplitItems
  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(filteredBoxSplitItems.length / pageSize))
  const resolvedBoxPage = Math.min(boxPage, pageCount)
  const pagedBoxSplitItems = filteredBoxSplitItems.slice((resolvedBoxPage - 1) * pageSize, resolvedBoxPage * pageSize)
  const selectedBoxItemIdSet = new Set(selectedBoxItemIds.filter((itemId) => itemById.has(itemId)))
  const selectedBoxItemCount = selectedBoxItemIdSet.size
  const allFilteredBoxItemsSelected = filteredBoxSplitItems.length > 0 && filteredBoxSplitItems.every((item) => selectedBoxItemIdSet.has(item.id))
  const editingBoxItem = editingBoxItemId ? itemById.get(editingBoxItemId) : null

  function changeBoxSplitItemFilter(filter: BoxSplitItemFilter) {
    if (filter === boxSplitItemFilter) return
    // ProductBoxSplitEditor keeps its dirty draft in ChinaWorkGuard even when this view unmounts.
    setBoxSplitItemFilter(filter)
    setBoxPage(1)
  }

  function editSavedBoxItem(itemId: string) {
    if (itemById.has(itemId) && !isPending && !guard.busy) setEditingBoxItemId(itemId)
  }

  function setBoxItemSelected(itemId: string, selected: boolean) {
    setSelectedBoxItemIds((current) => selected
      ? current.includes(itemId) ? current : [...current, itemId]
      : current.filter((id) => id !== itemId))
  }

  function setFilteredBoxItemsSelected(selected: boolean) {
    const filteredIds = new Set(filteredBoxSplitItems.map((item) => item.id))
    setSelectedBoxItemIds((current) => selected
      ? [...new Set([...current, ...filteredIds])]
      : current.filter((itemId) => !filteredIds.has(itemId)))
  }

  function saveBoxSplitItems(itemIds: string[], scope: 'selected' | 'all') {
    const draftsToSave = itemIds.flatMap((itemId) => {
      const draft = guard.getDraft(`box:${itemId}`)
      return draft ? [{ itemId, draft }] : []
    })
    if (draftsToSave.length === 0) {
      toast.error(scope === 'selected' ? '선택한 품목 중 저장할 변경사항이 없습니다.' : '저장할 박스분할 변경사항이 없습니다.')
      return
    }
    startTransition(async () => {
      const savedItemIds: string[] = []
      const saved = await guard.runTask(async () => {
        for (const { itemId, draft } of draftsToSave) {
          if (!await (draft.saveQuietly ?? draft.save)()) return false
          savedItemIds.push(itemId)
        }
        return true
      })
      if (savedItemIds.length > 0) {
        const savedIds = new Set(savedItemIds)
        const idsToClear = saved && scope === 'selected' ? new Set(itemIds) : savedIds
        setSelectedBoxItemIds((current) => current.filter((itemId) => !idsToClear.has(itemId)))
        // A later product can fail after an earlier one has committed. Refresh
        // committed rows so the remaining draft never works from stale totals.
        router.refresh()
      }
      if (!saved) {
        if (savedItemIds.length > 0) toast.error(`${savedItemIds.length.toLocaleString('ko-KR')}개 품목은 저장됐습니다. 나머지 변경사항을 확인한 뒤 다시 저장해주세요.`)
        return
      }
      toast.success(`${draftsToSave.length.toLocaleString('ko-KR')}개 품목의 박스분할을 저장했습니다.`)
    })
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string, afterSuccess?: () => void) {
    startTransition(async () => {
      await guard.runTask(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? '처리하지 못했습니다.')
        return false
      }
      afterSuccess?.()
      toast.success(successMessage)
      router.refresh()
      return true
      })
    })
  }

  function requestDispatch() {
    guard.requestConfirmation({
      title: '출고완료 처리',
      description: '포장된 수량을 SaaS 중국재고에서 차감하고 출고완료 처리할까요?',
      confirmLabel: '출고완료 처리',
      onConfirm: () => run(() => dispatchChinaOutboundShipmentAction({ shipmentId: shipment.id }), '출고완료 처리했습니다. SaaS 재고가 차감되었습니다.'),
    })
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 border-b pb-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold">{shipmentDisplayName(shipment)}</h2>
            <StatusBadge status={shipment.status} />
            <span className="text-sm text-muted-foreground">{shipment.plannedOutboundDate || '날짜 미입력'} · {shipment.originWarehouseCode} → {shipment.destinationName || '도착지 미입력'}</span>
            <span className="text-xs text-muted-foreground">{shipment.shipmentNo} · 상품 {items.length.toLocaleString('ko-KR')}종 · 출고 {totalOutboundQuantity.toLocaleString('ko-KR')}개 · 포장 {totalPackedQuantity.toLocaleString('ko-KR')}개</span>
          </div>
          {shipment.memo ? <p className="mt-1 text-xs text-muted-foreground">메모: {shipment.memo}</p> : null}
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          {[
            { type: 'boxes', label: '박스 쉽먼트 일괄 다운로드', enabled: canDownloadShipmentLabels, reason: '박스분할을 저장한 박스가 하나 이상 있어야 일괄 다운로드할 수 있습니다.' },
            { type: 'pallets', label: '파렛트 쉽먼트 일괄 다운로드', enabled: canDownloadPalletLabels, reason: '상품이 담긴 박스를 파렛트에 배정한 뒤 다운로드할 수 있습니다.' },
          ].map(({ type, label, enabled, reason }) => enabled ? (
            <a key={type} href={`${shipmentLabelsHref}?type=${type}`} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"><FileSpreadsheet className="size-4" /> {label}</a>
          ) : (
            <button key={type} type="button" disabled title={reason} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"><FileSpreadsheet className="size-4" /> {label}</button>
          ))}
          {[{ type: 'boxes', label: '박스 쉽먼트 바로 인쇄', enabled: canDownloadShipmentLabels }, { type: 'pallets', label: '파렛트 쉽먼트 바로 인쇄', enabled: canDownloadPalletLabels }].map(({ type, label, enabled }) => enabled ? <a key={type} href={`${shipmentLabelsHref}?type=${type}&format=print`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"><Printer className="size-4" />{label}</a> : <button key={type} type="button" disabled className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium disabled:opacity-50"><Printer className="size-4" />{label}</button>)}
          <WorkbookActions shipmentId={shipment.id} editable={editable} />
          <ChinaImportDocumentDialog shipmentId={shipment.id} />
          {stage === 'summary' ? <a href={`/api/purchasing/china-shipments/${encodeURIComponent(shipment.id)}/export`} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"><Download className="size-4" /> 적재현황 엑셀</a> : null}
          {shipment.status === 'ready' || (editable && stage === 'summary') ? <button type="button" disabled={isPending || cannotDispatch} onClick={requestDispatch} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"><Send className="size-4" /> 출고완료</button> : null}
        </div>
      </div>

      <nav className="grid gap-1 rounded-lg border bg-muted/20 p-1 sm:grid-cols-4" aria-label="중국출고 작업 단계">
        <StageButton active={stage === 'items'} step="1단계" title="출고품목" detail={`${items.length.toLocaleString('ko-KR')}종 · ${totalOutboundQuantity.toLocaleString('ko-KR')}개`} onClick={() => onStageChange('items')} />
        <StageButton active={stage === 'boxes'} step="2단계" title="박스분할" detail={`${totalPackedQuantity.toLocaleString('ko-KR')} / ${totalOutboundQuantity.toLocaleString('ko-KR')}개`} onClick={() => onStageChange('boxes')} />
        <StageButton active={stage === 'pallets'} step="3단계" title="파렛트적재" detail={`${palletSummaries.length} PLT + ${boxesWithItems.filter((box) => !box.palletId).length} BOX`} onClick={() => onStageChange('pallets')} />
        <StageButton active={stage === 'summary'} step="4단계" title="최종 적재리스트" detail={`박스 ${boxesWithItems.length.toLocaleString('ko-KR')}개`} onClick={() => onStageChange('summary')} />
      </nav>

      {stage === 'items' ? <section className="space-y-3"><ShipmentItemAdditionPanel shipmentId={shipment.id} inventoryItems={inventoryItems} editable={editable} isPending={isPending} /><ManualSamplePanel shipmentId={shipment.id} defaultWarehouseCode={shipment.originWarehouseCode} warehouseCodes={[...new Set([...warehouseCodes, ...inventoryItems.map((item) => item.warehouseCode)])]} editable={editable} isPending={isPending} />
        <OutboundItemsPanel detail={detail} editable={editable} isPending={isPending} boxItemsByItem={boxItemsByItem} /></section> : null}

      {stage === 'boxes' ? <section className="space-y-4">
        {editable && <MergeBoxesButton shipmentId={shipment.id} boxes={boxesWithItems} isPending={isPending} />}
        <SavedBoxContentsPanel shipmentId={shipment.id} summaries={savedBoxSummaries} filter={savedBoxFilter} editable={editable} isPending={isPending} onFilterChange={(filter) => setSavedBoxFilter(filter)} onEditItem={editSavedBoxItem} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div role="group" aria-label="박스분할 품목 상태 필터" className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={boxSplitItemFilter === 'all'} onClick={() => changeBoxSplitItemFilter('all')} className={`h-8 rounded-md border px-3 text-xs font-medium transition-colors ${boxSplitItemFilter === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>전체 품목 {sortedBoxSplitItems.length.toLocaleString('ko-KR')}</button>
              <button type="button" aria-pressed={boxSplitItemFilter === 'incomplete'} onClick={() => changeBoxSplitItemFilter('incomplete')} className={`h-8 rounded-md border px-3 text-xs font-medium transition-colors ${boxSplitItemFilter === 'incomplete' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>수량 부족 {incompleteBoxSplitItems.length.toLocaleString('ko-KR')}</button>
              <button type="button" aria-pressed={boxSplitItemFilter === 'complete'} onClick={() => changeBoxSplitItemFilter('complete')} className={`h-8 rounded-md border px-3 text-xs font-medium transition-colors ${boxSplitItemFilter === 'complete' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>수량 일치 {completeBoxSplitItems.length.toLocaleString('ko-KR')}</button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium hover:bg-muted">
              <input type="checkbox" aria-label="현재 필터 품목 전체 선택" checked={allFilteredBoxItemsSelected} onChange={(event) => setFilteredBoxItemsSelected(event.target.checked)} disabled={!editable || isPending} className="size-3.5 accent-primary" />
              현재 필터 전체 선택
            </label>
            <span className="text-xs text-muted-foreground">선택 {selectedBoxItemCount.toLocaleString('ko-KR')}개</span>
            <button type="button" disabled={!editable || isPending || selectedBoxItemCount === 0} onClick={() => saveBoxSplitItems([...selectedBoxItemIdSet], 'selected')} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"><Check className="size-3.5" /> 선택 저장</button>
            <button type="button" disabled={!editable || isPending} onClick={() => saveBoxSplitItems(sortedBoxSplitItems.map((item) => item.id), 'all')} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"><Check className="size-3.5" /> 전체 저장</button>
            <Pagination page={resolvedBoxPage} pageCount={pageCount} onPrevious={() => guard.requestNavigation(() => setBoxPage((current) => Math.max(1, current - 1)), ['box'])} onNext={() => guard.requestNavigation(() => setBoxPage((current) => Math.min(pageCount, current + 1)), ['box'])} />
          </div>
        </div>
        <div className="space-y-3">
          {pagedBoxSplitItems.length === 0 ? <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">선택한 상태의 품목이 없습니다.</p> : null}
          {pagedBoxSplitItems.map((item) => {
            const allocations = (boxItemsByItem.get(item.id) ?? []).flatMap((allocation) => {
              const box = boxById.get(allocation.boxId)
              return box ? [{ allocation, box }] : []
            })
            const quantities = new Map<number, number>()
            for (const { allocation } of allocations) quantities.set(allocation.quantity, (quantities.get(allocation.quantity) ?? 0) + 1)
            return <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3">
              <div className="min-w-0"><p data-no-translate className="text-sm font-medium">{item.sku}</p><p data-no-translate className="text-sm">{item.productName}{item.optionName ? ` · ${item.optionName}` : ''}</p>{item.chineseProductName && <p data-no-translate className="text-sm text-muted-foreground">{item.chineseProductName}</p>}<p className="mt-1 text-xs text-muted-foreground">{allocations.length}박스 · {item.packedQuantity.toLocaleString('ko-KR')} / {item.reservedQuantity.toLocaleString('ko-KR')}개{allocations.length ? ` · ${[...quantities].map(([quantity, count]) => `${quantity}개 × ${count}`).join(' / ')}` : ''}</p></div>
              <div className="flex items-center gap-3">{guard.getDraft(`box:${item.id}`) && <span className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">미저장 변경 있음</span>}<label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" aria-label={`${item.sku} 저장 선택`} checked={selectedBoxItemIdSet.has(item.id)} onChange={(event) => setBoxItemSelected(item.id, event.target.checked)} disabled={!editable || isPending} />저장 선택</label><button type="button" aria-label={`${item.sku} 박스분할 수정`} onClick={() => editSavedBoxItem(item.id)} disabled={isPending || guard.busy} className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">{editable ? '수정' : '보기'}</button></div>
            </article>
          })}
        </div>
        <div className="flex justify-end"><Pagination page={resolvedBoxPage} pageCount={pageCount} onPrevious={() => guard.requestNavigation(() => setBoxPage((current) => Math.max(1, current - 1)), ['box'])} onNext={() => guard.requestNavigation(() => setBoxPage((current) => Math.min(pageCount, current + 1)), ['box'])} /></div>
        {editingBoxItem && <ItemBoxSplitDialog key={editingBoxItem.id} detail={detail} item={editingBoxItem} editable={editable} isPending={isPending} allowDeferredSave onClose={() => setEditingBoxItemId(null)} />}
      </section> : null}

      {stage === 'pallets' ? <section className="space-y-4">
        {boxesWithItems.length === 0 ? <EmptyStage title="먼저 박스분할을 저장해주세요." description="박스에 상품이 담긴 뒤 파렛트 번호를 입력할 수 있습니다." onMove={() => onStageChange('boxes')} moveLabel="2단계로 이동" /> : <PalletContentsPanel shipmentId={shipment.id} summaries={palletSummaries} boxItems={detail.boxItems} items={items} editable={editable} isPending={isPending} assignmentEditor={<PalletAssignmentPanel shipmentId={shipment.id} boxes={boxesWithItems} boxItemsByBox={boxItemsByBox} itemById={itemById} palletById={palletById} editable={editable} isPending={isPending} />} unassignedBoxes={boxesWithItems.filter((box) => !box.palletId)} />}
      </section> : null}

      {stage === 'summary' ? <section className="space-y-4">
        {hasIncompleteBoxSplit ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">박스에 담긴 수량과 실제 출고수량이 다른 품목이 있습니다. 박스분할 수량을 확인해주세요.</p> : null}
        {hasUnassignedPalletBox ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">파렛트에 배정하지 않은 박스는 낱박스로 출고됩니다.</p> : null}
        {boxesWithItems.length > 0 ? <PalletContentsPanel shipmentId={shipment.id} summaries={palletSummaries} unassignedBoxes={boxesWithItems.filter((box) => !box.palletId)} boxItems={detail.boxItems} items={items} editable={false} isPending={isPending} /> : <EmptyStage title="파렛트에 적재된 박스가 없습니다." description="3단계에서 박스별 파렛트 번호를 입력하면 최종 적재리스트가 만들어집니다." onMove={() => onStageChange('pallets')} moveLabel="3단계로 이동" />}
      </section> : null}
    </section>
  )
}

function OutboundItemsPanel({ detail, editable, isPending, boxItemsByItem }: {
  detail: ChinaShipmentDetailView
  editable: boolean
  isPending: boolean
  boxItemsByItem: Map<string, ChinaShipmentDetailView['boxItems']>
}) {
  const { items, boxes } = detail
  const [editingId, setEditingId] = useState<string | null>(null)
  const sortedItems = [...items].sort(compareShipmentItems)
  const editingItem = items.find((item) => item.id === editingId)
  return <section className="overflow-hidden rounded-lg border">
    <div className="border-b bg-muted/20 px-4 py-3"><h3 className="font-semibold">1단계 · 출고품목 확인</h3></div>
    <div className="overflow-x-auto"><table className="min-w-[1100px] w-full text-sm">
      <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>
        {['품목코드', '품목구분', '상품명(한국어)', '상품명(중국어)', '옵션', '현재고', '실제 출고수량', '분할 수량', '박스 수·박스별 수량', '입고 송장·포장정보', '관리'].map((label) => <th key={label} className="px-3 py-2 text-left font-medium">{label}</th>)}
      </tr></thead>
      <tbody>{sortedItems.map((item) => {
        const allocations = boxItemsByItem.get(item.id) ?? []
        const quantities = new Map<number, number>()
        for (const allocation of allocations) quantities.set(allocation.quantity, (quantities.get(allocation.quantity) ?? 0) + 1)
        const receipts = [...new Map((item.receiptPacking ?? []).map((piece) => [piece.receiptBoxId, piece])).values()]
        return <tr key={item.id} className="border-t align-top">
          <td data-no-translate className="px-3 py-3 font-medium">{item.sku}</td><td className="px-3 py-3">{item.itemCategory || '상품'}</td><td className="px-3 py-3"><PurchasingProductImageButton shipmentItemId={item.id} productName={item.productName} imageData={item.productImage} /></td><td className="px-3 py-3"><ChineseNameEditor key={`${item.id}:${item.chineseProductName ?? ''}`} shipmentId={detail.shipment.id} item={item} editable={editable} isPending={isPending} /></td><td data-no-translate className="px-3 py-3 text-muted-foreground">{item.optionName || '-'}</td>
          <td className="px-3 py-3 tabular-nums"><strong>{item.onHandQuantity == null ? '—' : `${item.onHandQuantity.toLocaleString('ko-KR')}개`}</strong>{item.availableQuantity != null && <div className="mt-1 text-xs text-muted-foreground">작업 가능 {item.availableQuantity.toLocaleString('ko-KR')}개</div>}</td>
          <td className="px-3 py-3 font-semibold tabular-nums">{item.reservedQuantity.toLocaleString('ko-KR')}개</td><td className="px-3 py-3 tabular-nums">{item.packedQuantity.toLocaleString('ko-KR')}개</td>
          <td className="px-3 py-3">{allocations.length ? <details><summary className="cursor-pointer text-xs">{allocations.length}박스 · {[...quantities].map(([quantity, count]) => `${quantity}개 × ${count}`).join(' / ')}</summary><div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">{allocations.map((allocation) => <p key={allocation.id}><span data-no-translate>{boxes.find((box) => box.id === allocation.boxId)?.boxNo}</span>번: {allocation.quantity}개</p>)}</div></details> : <span className="text-xs text-muted-foreground">미분할</span>}</td>
          <td className="px-3 py-3 text-xs">{receipts.length ? <details><summary className="cursor-pointer">입고 {receipts.length}박스 · 송장 {new Set(receipts.map((piece) => piece.trackingNumber)).size}개</summary><div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{receipts.map((piece) => <p key={piece.receiptBoxId}><span data-no-translate>{piece.trackingNumber}</span> · 입고 {piece.receivedQuantity}개/박스</p>)}</div></details> : <span className="text-muted-foreground">검수 포장정보 없음</span>}</td>
          <td className="px-3 py-3"><button type="button" disabled={isPending} aria-label={`${item.sku} 박스분할 수정`} onClick={() => setEditingId(item.id)} className="h-8 whitespace-nowrap rounded-md border px-3 text-xs font-medium hover:bg-muted">{editable ? '박스분할 수정' : '박스분할 보기'}</button></td>
        </tr>
      })}</tbody>
    </table></div>
    {editingItem && <ItemBoxSplitDialog key={editingItem.id} detail={detail} item={editingItem} editable={editable} isPending={isPending} onClose={() => setEditingId(null)} />}
  </section>
}

function ItemBoxSplitDialog({ detail, item, editable, isPending, onClose, allowDeferredSave = false }: { detail: ChinaShipmentDetailView; item: ChinaShipmentDetailView['items'][number]; editable: boolean; isPending: boolean; onClose: () => void; allowDeferredSave?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const guard = useChinaWorkGuard()
  const [closeWarning, setCloseWarning] = useState(false)
  useEffect(() => { ref.current?.showModal() }, [])
  function requestClose() {
    if (guard.busy || isPending) return
    if (guard.getDraft(`box:${item.id}`)) { setCloseWarning(true); return }
    ref.current?.close()
  }
  const allocations = detail.boxItems.filter((entry) => entry.shipmentItemId === item.id).flatMap((allocation) => {
    const box = detail.boxes.find((candidate) => candidate.id === allocation.boxId)
    return box ? [{ allocation, box }] : []
  })
  return <dialog ref={ref} data-purchasing-translate onClose={(event) => { event.stopPropagation(); onClose() }} aria-label={`${item.sku} 박스분할`} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); requestClose() }} className="fixed inset-0 m-auto max-h-[92dvh] w-[min(72rem,96vw)] overflow-y-auto rounded-xl border bg-background p-4 text-foreground shadow-xl backdrop:bg-black/40">
    <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">출고품목 · 자동 박스분할<TitleHelp title="자동 박스분할">박스당 수량 기준은 마지막 박스에 잔량을 담고, 총 박스 수 기준은 균등 분할합니다. 저장 전에 박스번호를 수정할 수 있습니다.</TitleHelp></h3><button type="button" onClick={requestClose} disabled={guard.busy || isPending} className="h-8 rounded-md border px-3 text-sm">닫기</button></div>
    {closeWarning && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted p-3 text-sm"><span>저장하지 않은 박스분할이 있습니다.</span><button type="button" className="rounded border px-2 py-1" onClick={() => setCloseWarning(false)}>계속 수정</button><button type="button" className="rounded border px-2 py-1" disabled={guard.busy} onClick={async () => { const draft = guard.getDraft(`box:${item.id}`); if (draft && await guard.runTask(draft.save)) ref.current?.close() }}>저장하고 닫기</button>{allowDeferredSave && <button type="button" className="rounded border px-2 py-1" disabled={guard.busy} onClick={() => ref.current?.close()}>임시 보관 후 닫기</button>}<button type="button" className="rounded border px-2 py-1" disabled={guard.busy} onClick={() => { guard.getDraft(`box:${item.id}`)?.discard(); guard.setDraft(`box:${item.id}`, null); ref.current?.close() }}>변경 취소</button></div>}
    <ProductBoxSplitEditor shipmentId={detail.shipment.id} item={item} allocations={allocations} allBoxes={detail.boxes} allBoxItems={detail.boxItems} editable={editable} isPending={isPending || guard.busy} selected={false} onSelectedChange={() => {}} showSelection={false} onSaved={() => ref.current?.close()} />
  </dialog>
}

function ShipmentItemAdditionPanel({ shipmentId, inventoryItems, editable, isPending }: {
  shipmentId: string
  inventoryItems: ChinaShipmentStockItem[]
  editable: boolean
  isPending: boolean
}) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const [isOpen, setIsOpen] = useState(false)
  const [isAdding, startAdding] = useTransition()
  const [stock, setStock] = useState(inventoryItems)
  const [loadingStock, setLoadingStock] = useState(false)
  const [stockError, setStockError] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  async function openItems() {
    setIsOpen(true)
    if (inventoryItems.length) return
    setLoadingStock(true); setStockError('')
    try {
      const response = await fetch('/api/purchasing/china-shipments/available-stock', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '재고를 불러오지 못했습니다.')
      setStock(data.items)
    } catch (error) { setStockError(error instanceof Error ? error.message : '재고를 불러오지 못했습니다.') }
    finally { setLoadingStock(false) }
  }
  const additionMayExist = useRef(false)
  const [search, setSearch] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const searchKeyword = search.trim().toLocaleLowerCase('ko-KR')
  const availableItems = stock
    .filter((item) => item.availableQuantity > 0)
    .filter((item) => matchesChinaStockPeriod(item.lastReceivedAt, fromDate, toDate))
    .filter((item) => !searchKeyword || [item.sku, item.productName, item.chineseProductName ?? '', item.optionName ?? '', item.warehouseCode]
      .some((value) => value.toLocaleLowerCase('ko-KR').includes(searchKeyword)))
    .sort(compareShipmentItems)
  const additionalLines = stock.flatMap((item) => {
    const quantity = positiveInteger(quantities[item.id] ?? '')
    return quantity ? [{ inventoryId: item.id, quantity }] : []
  })
  const totalQuantity = additionalLines.reduce((total, line) => total + line.quantity, 0)
  const disabled = !editable || isPending || isAdding || loadingStock

  async function saveAdditionalItems() {
      if (additionMayExist.current) {
        toast.error('품목이 이미 추가됐을 수 있습니다. 현재 출고품목을 먼저 확인해주세요.')
        return false
      }
      if (additionalLines.length === 0 || Object.values(quantities).some((value) => value.trim() !== '' && !positiveInteger(value))) {
        toast.error('추가할 품목과 올바른 수량을 입력해주세요.')
        return false
      }
      let result: Awaited<ReturnType<typeof addChinaOutboundShipmentItemsAction>>
      try { result = await addChinaOutboundShipmentItemsAction({ shipmentId, lines: additionalLines }) } catch {
        additionMayExist.current = true
        toast.error('응답이 끊겼지만 품목이 추가됐을 수 있습니다. 중복 추가를 막기 위해 출고품목을 먼저 확인해주세요.')
        return false
      }
      if (!result.ok) {
        toast.error(result.error)
        return false
      }
      guard.setDraft('additional-items', null)
      setQuantities({})
      setSearch('')
      setIsOpen(false)
      toast.success(`출고품목 ${additionalLines.length.toLocaleString('ko-KR')}종 · ${totalQuantity.toLocaleString('ko-KR')}개를 추가했습니다.`)
      router.refresh()
      return true
  }

  useChinaWorkDraft('additional-items', Object.values(quantities).some((value) => value.trim() !== '') ? {
    kind: 'items', label: '추가 출고품목', snapshot: quantities, save: saveAdditionalItems,
    discard: () => { setQuantities({}); setSearch(''); setIsOpen(false) },
  } : null)

  function addItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startAdding(async () => {
      await guard.runTask(saveAdditionalItems)
    })
  }

  return <section className="rounded-lg border bg-muted/20 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">출고품목 추가<TitleHelp title="출고품목 추가">선정 후에도 품목이나 추가 수량을 같은 중국출고작업에 예약할 수 있습니다.</TitleHelp></h3></div><button type="button" disabled={disabled} onClick={() => isOpen ? guard.requestNavigation(() => setIsOpen(false), ['items']) : void openItems()} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"><Plus className="size-3.5" /> {isOpen ? '추가 닫기' : '품목 추가'}</button></div>{!editable ? <p className="mt-3 text-xs text-muted-foreground">포장완료 또는 출고완료 상태에서는 출고품목을 추가할 수 없습니다.</p> : null}{isOpen ? <form onSubmit={addItems} className="mt-3 space-y-3 border-t pt-3"><div className="flex flex-wrap gap-3"><label className="text-xs">최근 입고·재고등록일 시작<input type="date" aria-label="입고일 시작" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={inputClass} /></label><label className="text-xs">최근 입고·재고등록일 종료<input type="date" aria-label="입고일 종료" value={toDate} onChange={(event) => setToDate(event.target.value)} className={inputClass} /></label><button type="button" onClick={() => { setFromDate(''); setToDate('') }} className="self-end rounded border px-3 py-2 text-xs">기간 초기화</button></div>{fromDate && toDate && fromDate > toDate && <p role="alert">조회 시작일과 종료일을 확인해주세요.</p>}{loadingStock && <p>재고 불러오는 중</p>}{stockError && <p role="alert">{stockError}</p>}<input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} placeholder="상품명, 상품코드, 옵션, 창고 검색" disabled={disabled} /><div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">{availableItems.length === 0 ? <p className="rounded-md border border-dashed bg-background px-3 py-8 text-center text-sm text-muted-foreground">조건에 맞는 추가 가능 재고가 없습니다.</p> : availableItems.map((item) => <article key={item.id} className="rounded-md border bg-background p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">출고 창고: {item.warehouseCode}</p><p data-no-translate className="mt-1 truncate font-medium">{item.productName}</p>{item.chineseProductName && <p data-no-translate className="text-sm text-muted-foreground">{item.chineseProductName}</p>}<p className="text-xs text-muted-foreground">최근 입고·재고등록일: {chinaStockDate(item.lastReceivedAt) || '미입력'}</p><p data-no-translate className="mt-1 truncate text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</p></div><div className="flex items-end gap-3"><p className="text-right text-xs font-medium text-emerald-700">추가 가능 {item.availableQuantity.toLocaleString('ko-KR')}개</p><label className="block"><span className="mb-1 block text-xs text-muted-foreground">추가 출고</span><input type="number" min="0" max={item.availableQuantity} step="1" value={quantities[item.id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="h-9 w-24 rounded-md border px-2 text-right text-sm tabular-nums" placeholder="0" disabled={disabled} /></label></div></div></article>)}</div><div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p className="text-xs text-muted-foreground">추가 예정: {additionalLines.length.toLocaleString('ko-KR')}개 품목 · {totalQuantity.toLocaleString('ko-KR')}개</p><div className="flex gap-2"><button type="button" disabled={disabled} onClick={() => { setQuantities({}); setSearch(''); setIsOpen(false) }} className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60">취소</button><button type="submit" disabled={disabled || additionalLines.length === 0} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isAdding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} 선택 품목 추가</button></div></div></form> : null}</section>
}

function ProductBoxSplitEditor({ shipmentId, item, allocations, allBoxes = [], allBoxItems = [], editable, isPending, selected, onSelectedChange, onSaved, showSelection = true }: {
  shipmentId: string
  item: ChinaShipmentDetailView['items'][number]
  allocations: Array<{ allocation: ChinaShipmentDetailView['boxItems'][number]; box: ChinaShipmentDetailView['boxes'][number] }>
  editable: boolean
  isPending: boolean
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  allBoxes?: ChinaShipmentDetailView['boxes']
  allBoxItems?: ChinaShipmentDetailView['boxItems']
  onSaved?: () => void
  showSelection?: boolean
}) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const draftId = `box:${item.id}`
  const retainedSnapshot = asBoxSplitDraftSnapshot(guard.getDraft(draftId)?.snapshot)
  const [initialDrafts, setInitialDrafts] = useState<BoxSplitDraft[]>(() => cloneBoxSplitDrafts(retainedSnapshot?.baseline ?? (allocations.length > 0
    ? allocations.map(({ allocation, box }) => ({ key: allocation.id, boxId: box.id, boxNo: box.boxNo, quantity: String(allocation.quantity), lengthCm: box.lengthCm == null ? '' : String(box.lengthCm), widthCm: box.widthCm == null ? '' : String(box.widthCm), heightCm: box.heightCm == null ? '' : String(box.heightCm) }))
    : [createBoxSplitDraft()])))
  const [drafts, setDrafts] = useState<BoxSplitDraft[]>(() => cloneBoxSplitDrafts(retainedSnapshot?.drafts ?? initialDrafts))
  const [initialBoxSplitStatus, setInitialBoxSplitStatus] = useState<BoxSplitStatus>(() => retainedSnapshot?.baselineStatus ?? item.boxSplitStatus)
  const [quantityPerBox, setQuantityPerBox] = useState('')
  const [boxCount, setBoxCount] = useState('')
  function occupiedNumbers() { return [...allBoxes.map((box) => box.boxNo), ...(guard.getBoxNumbers?.(draftId) ?? [])] }
  function generateSplits() {
    try {
      const plan = planAutomaticBoxSplit(item.reservedQuantity, quantityPerBox.trim() ? { quantityPerBox: Number(quantityPerBox), ...(boxCount.trim() ? { boxCount: Number(boxCount) } : {}) } : { boxCount: Number(boxCount) }, occupiedNumbers())
      setDrafts(plan.map((entry) => ({ ...createBoxSplitDraft(), boxNo: entry.boxNo, quantity: String(entry.quantity), autoNumber: true })))
    } catch (error) { toast.error(error instanceof Error ? error.message : '박스분할 값을 확인해주세요.') }
  }
  const splitQuantity = drafts.reduce((total, draft) => total + (positiveInteger(draft.quantity) ?? 0), 0)
  // Keep the legacy stored status consistent with quantities without a manual selector.
  const currentBoxSplitStatus: BoxSplitStatus = splitQuantity === item.reservedQuantity ? 'completed' : 'in_progress'

  function patchDraft(key: string, patch: Partial<BoxSplitDraft>) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...patch, ...(patch.boxNo !== undefined ? { autoNumber: false } : {}) } : draft))
  }

  async function saveDraft(options: { quiet?: boolean; refresh?: boolean } = {}) {
    const nextAllocations = drafts
      .filter((draft) => [draft.boxNo, draft.quantity, draft.lengthCm, draft.widthCm, draft.heightCm].some((value) => value.trim()))
      .map((draft) => {
        const previous = initialDrafts.find((candidate) => candidate.boxNo.trim() === draft.boxNo.trim())
        const dimensionsChanged = !previous || [draft.lengthCm, draft.widthCm, draft.heightCm].some((value, index) => value !== [previous.lengthCm, previous.widthCm, previous.heightCm][index])
        return {
          boxNo: draft.boxNo.trim(),
          ...(draft.autoNumber ? { autoNumber: true } : {}),
          ...(draft.boxId && draft.boxNo.trim() !== initialDrafts.find((entry) => entry.boxId === draft.boxId)?.boxNo
            && !allBoxes.some((box) => box.id !== draft.boxId && box.boxNo === draft.boxNo.trim())
            && !allBoxItems.some((entry) => entry.boxId === draft.boxId && entry.shipmentItemId !== item.id)
            ? { existingBoxId: draft.boxId } : {}),
          quantity: Number(draft.quantity),
          // Existing shared boxes keep their current dimensions unless this editor actually changed them.
          lengthCm: dimensionsChanged ? optionalNumber(draft.lengthCm) : null,
          widthCm: dimensionsChanged ? optionalNumber(draft.widthCm) : null,
          heightCm: dimensionsChanged ? optionalNumber(draft.heightCm) : null,
        }
      })
    const hasBoxSplitStatusChange = currentBoxSplitStatus !== initialBoxSplitStatus
    const result = await saveChinaOutboundItemBoxSplitsAction({
      shipmentId,
      shipmentItemId: item.id,
      allocations: nextAllocations,
      ...(hasBoxSplitStatusChange ? { boxSplitStatus: currentBoxSplitStatus } : {}),
    })
    if (!result.ok) {
      toast.error(result.error ?? '박스분할을 저장하지 못했습니다.')
      return false
    }
    setInitialDrafts(cloneBoxSplitDrafts(drafts))
    setInitialBoxSplitStatus(currentBoxSplitStatus)
    guard.setDraft(draftId, null)
    if (!options.quiet) toast.success(`${item.productName}의 박스분할을 저장했습니다.`)
    if (options.refresh !== false) router.refresh()
    if (!options.quiet) onSaved?.()
    return true
  }

  const dirty = boxDraftValues(drafts) !== boxDraftValues(initialDrafts)
  useChinaWorkDraft(draftId, dirty ? {
    boxNumbers: drafts.map((draft) => draft.boxNo).filter(Boolean),
    kind: 'box', label: `${item.productName} 박스분할`, snapshot: {
      drafts: cloneBoxSplitDrafts(drafts),
      baseline: cloneBoxSplitDrafts(initialDrafts),
      status: currentBoxSplitStatus,
      baselineStatus: initialBoxSplitStatus,
    }, save: saveDraft, saveQuietly: () => saveDraft({ quiet: true, refresh: false }),
    boxDimensions: drafts.flatMap((draft) => {
      const previous = initialDrafts.find((candidate) => candidate.boxNo.trim() === draft.boxNo.trim())
      const dimensions = [draft.lengthCm, draft.widthCm, draft.heightCm]
      const changed = !previous || dimensions.some((value, index) => value !== [previous.lengthCm, previous.widthCm, previous.heightCm][index])
      return changed && draft.boxNo.trim() && dimensions.every((value) => value.trim() && Number.isFinite(Number(value)))
        ? [{ boxNo: draft.boxNo.trim(), dimensions: dimensions.map((value) => String(Number(value))).join(':') }] : []
    }),
    discard: () => {
      setDrafts(cloneBoxSplitDrafts(initialDrafts))
      },
  } : null)

  function save() { void guard.runTask(saveDraft) }

  return (
    <article id={`shipment-box-item-${item.id}`} className="overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-col gap-2 border-b bg-muted/20 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p data-no-translate className="font-semibold">{item.sku}</p>
            <TitleHelp title="박스분할">규격은 가로·세로·높이를 모두 입력하면 CBM이 자동 계산됩니다. 한 박스에 여러 품목을 담으려면 같은 박스번호를 입력하세요.</TitleHelp><ProgressBadge completed={currentBoxSplitStatus === 'completed'} detail={`${item.packedQuantity.toLocaleString('ko-KR')} / ${item.reservedQuantity.toLocaleString('ko-KR')}개`} />
          </div>
          <p className="mt-1 truncate text-sm"><PurchasingProductImageButton shipmentItemId={item.id} productName={item.productName} imageData={item.productImage} /><span data-no-translate>{item.optionName ? ` · ${item.optionName}` : ''}</span></p>{item.chineseProductName && <p data-no-translate className="mt-1 text-sm text-muted-foreground">{item.chineseProductName}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showSelection && <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium">
            <input type="checkbox" aria-label={`${item.sku} 저장 선택`} checked={selected} onChange={(event) => onSelectedChange(event.target.checked)} disabled={!editable || isPending} className="size-3.5 accent-primary" />
            저장 선택
          </label>}
          <p className={`text-sm tabular-nums ${splitQuantity > item.reservedQuantity ? 'font-medium text-red-700' : 'text-muted-foreground'}`}>
            입력 중 {splitQuantity.toLocaleString('ko-KR')} / {item.reservedQuantity.toLocaleString('ko-KR')}개
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-b bg-muted/10 p-3">
        <label className="text-xs">총 박스 수<input aria-label={`${item.sku} 총 박스 수`} type="number" min="1" max="5000" step="1" value={boxCount} disabled={!editable || isPending || guard.busy} className={`${compactInputClass} mt-1 w-28`} onChange={(event) => { setBoxCount(event.target.value); setQuantityPerBox('') }} placeholder="자동 계산" /></label>
        <label className="text-xs">박스당 수량<input aria-label={`${item.sku} 박스당 수량`} type="number" min="1" step="1" value={quantityPerBox} disabled={!editable || isPending || guard.busy} className={`${compactInputClass} mt-1 w-28`} onChange={(event) => { setQuantityPerBox(event.target.value); const value = positiveInteger(event.target.value); setBoxCount(value ? String(Math.ceil(item.reservedQuantity / value)) : '') }} placeholder="자동 분배" /></label>
        <button type="button" disabled={!editable || isPending || guard.busy} onClick={generateSplits} className="h-8 rounded-md border bg-background px-3 text-xs font-medium">자동 분할 미리보기</button>

      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[880px] w-full text-sm">
          <thead className="bg-muted/10 text-xs text-muted-foreground">
            <tr>
              <th className="w-[22%] px-3 py-2 text-left font-medium">박스번호</th>
              <th className="w-[14%] px-3 py-2 text-right font-medium">적재수량</th>
              <th className="w-[13%] px-3 py-2 text-right font-medium">가로(cm)</th>
              <th className="w-[13%] px-3 py-2 text-right font-medium">세로(cm)</th>
              <th className="w-[13%] px-3 py-2 text-right font-medium">높이(cm)</th>
              <th className="w-[15%] px-3 py-2 text-right font-medium">CBM</th>
              <th className="w-[10%] px-3 py-2 text-center font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => {
              const cbm = calculateChinaOutboundBoxCbm({
                lengthCm: optionalNumber(draft.lengthCm),
                widthCm: optionalNumber(draft.widthCm),
                heightCm: optionalNumber(draft.heightCm),
              })
              return (
                <tr key={draft.key} className="border-t">
                  <td className="px-3 py-2">
                    <input
                      value={draft.boxNo}
                      onChange={(event) => patchDraft(draft.key, { boxNo: event.target.value })}
                      disabled={!editable || isPending}
                      inputMode="numeric"
                      className={compactInputClass}
                      placeholder="1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={draft.quantity}
                      onChange={(event) => patchDraft(draft.key, { quantity: event.target.value })}
                      disabled={!editable || isPending}
                      className={`${compactInputClass} text-right tabular-nums`}
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.lengthCm}
                      onChange={(event) => patchDraft(draft.key, { lengthCm: event.target.value })}
                      disabled={!editable || isPending}
                      className={`${compactInputClass} text-right tabular-nums`}
                      placeholder="선택"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.widthCm}
                      onChange={(event) => patchDraft(draft.key, { widthCm: event.target.value })}
                      disabled={!editable || isPending}
                      className={`${compactInputClass} text-right tabular-nums`}
                      placeholder="선택"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.heightCm}
                      onChange={(event) => patchDraft(draft.key, { heightCm: event.target.value })}
                      disabled={!editable || isPending}
                      className={`${compactInputClass} text-right tabular-nums`}
                      placeholder="선택"
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatChinaOutboundCbm(cbm) ?? '-'}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      disabled={!editable || isPending || drafts.length === 1}
                      onClick={() => setDrafts((current) => current.filter((candidate) => candidate.key !== draft.key))}
                      className="h-8 rounded-md border border-red-200 px-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-4 py-3">

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!editable || isPending}
            onClick={() => setDrafts((current) => [...current, { ...createBoxSplitDraft(), boxNo: nextAvailableBoxNumbers(1, [...occupiedNumbers(), ...current.map((draft) => draft.boxNo)])[0], autoNumber: true }])}
            className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            <Plus className="size-3.5" /> 박스 추가
          </button>
          <button
            type="button"
            disabled={!editable || isPending}
            onClick={save}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} 박스분할 저장
          </button>
        </div>
      </div>
    </article>
  )
}

function PalletAssignmentPanel({ shipmentId, boxes, boxItemsByBox, itemById, palletById, editable, isPending }: {
  shipmentId: string
  boxes: ChinaShipmentDetailView['boxes']
  boxItemsByBox: Map<string, ChinaShipmentDetailView['boxItems']>
  itemById: Map<string, ChinaShipmentDetailView['items'][number]>
  palletById: Map<string, ChinaShipmentDetailView['pallets'][number]>
  editable: boolean
  isPending: boolean
}) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const sortedBoxes = [...boxes].sort((left, right) => left.boxNo.localeCompare(right.boxNo, 'ko-KR', { numeric: true }))
  const [initialNumbers, setInitialNumbers] = useState<Record<string, string>>(() => Object.fromEntries(sortedBoxes.map((box) => [box.boxNo, box.palletId ? palletById.get(box.palletId)?.palletNo ?? '' : ''])))
  const [palletNumbers, setPalletNumbers] = useState<Record<string, string>>(() => ({ ...initialNumbers }))
  const [selectedBoxNos, setSelectedBoxNos] = useState<string[]>([])
  const changedBoxes = sortedBoxes.filter((box) => (palletNumbers[box.boxNo] ?? '').trim() !== (initialNumbers[box.boxNo] ?? '').trim())
  const selected = new Set(selectedBoxNos)
  const allSelected = sortedBoxes.length > 0 && sortedBoxes.every((box) => selected.has(box.boxNo))

  function selectBox(boxNo: string, checked: boolean) {
    setSelectedBoxNos((current) => checked ? [...new Set([...current, boxNo])] : current.filter((candidate) => candidate !== boxNo))
  }

  function selectAll(checked: boolean) {
    const visible = new Set(sortedBoxes.map((box) => box.boxNo))
    setSelectedBoxNos((current) => checked ? [...new Set([...current, ...visible])] : current.filter((boxNo) => !visible.has(boxNo)))
  }

  async function saveDraft(boxNos?: string[], quiet = false) {
    const requested = boxNos ? new Set(boxNos) : null
    const boxesToSave = changedBoxes.filter((box) => !requested || requested.has(box.boxNo))
    if (!boxesToSave.length) {
      if (!quiet) toast.error(requested ? '선택한 박스 중 저장할 파렛트 배정 변경사항이 없습니다.' : '저장할 파렛트 배정 변경사항이 없습니다.')
      return quiet
    }
    const assignments = boxesToSave.map((box) => ({ boxNo: box.boxNo, palletNo: palletNumbers[box.boxNo]?.trim() || null }))
    const result = await assignChinaOutboundBoxesToPalletsAction({ shipmentId, assignments })
    if (!result.ok) { toast.error(result.error ?? '파렛트 적재를 저장하지 못했습니다.'); return false }
    setInitialNumbers((current) => ({ ...current, ...Object.fromEntries(boxesToSave.map((box) => [box.boxNo, palletNumbers[box.boxNo] ?? ''])) }))
    const clearedBoxNos = requested ?? new Set(sortedBoxes.map((box) => box.boxNo))
    setSelectedBoxNos((current) => current.filter((boxNo) => !clearedBoxNos.has(boxNo)))
    if (boxesToSave.length === changedBoxes.length) guard.setDraft('pallet-assignments', null)
    if (!quiet) toast.success(`${boxesToSave.length.toLocaleString('ko-KR')}개 박스의 파렛트 배정을 저장했습니다.`)
    router.refresh()
    return true
  }

  useChinaWorkDraft('pallet-assignments', changedBoxes.length > 0 ? {
    kind: 'pallet', label: '파렛트 적재', snapshot: palletNumbers, save: () => saveDraft(undefined, true),
    discard: () => setPalletNumbers({ ...initialNumbers }),
  } : null)

  return <section className="overflow-hidden rounded-lg border">
    <div className="overflow-x-auto"><table className="min-w-[850px] w-full text-sm"><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-center font-medium"><input type="checkbox" aria-label="표시된 파렛트 배정 전체 선택" checked={allSelected} onChange={(event) => selectAll(event.target.checked)} disabled={!editable || isPending || guard.busy} className="size-3.5 accent-primary" /></th><th className="px-3 py-2 text-left font-medium">박스번호</th><th className="px-3 py-2 text-left font-medium">적재 상품</th><th className="px-3 py-2 text-right font-medium">적재수량</th><th className="px-3 py-2 text-right font-medium">박스 규격</th><th className="px-3 py-2 text-right font-medium">CBM</th><th className="px-3 py-2 text-center font-medium">파렛트번호</th></tr></thead><tbody>{sortedBoxes.map((box) => {
      const boxItems = boxItemsByBox.get(box.id) ?? []
      const quantity = boxItems.reduce((total, item) => total + item.quantity, 0)
      const products = boxItems.flatMap((boxItem) => {
        const item = itemById.get(boxItem.shipmentItemId)
        return item ? [{ id: boxItem.id, identity: `${item.sku} ${item.productName}${item.optionName ? ` · ${item.optionName}` : ''}${item.chineseProductName ? ` / ${item.chineseProductName}` : ''}`, quantity: boxItem.quantity }] : []
      })
      const cbm = calculateChinaOutboundBoxCbm(box)
      return <tr key={box.id} className="border-t align-top"><td className="px-3 py-3 text-center"><input type="checkbox" aria-label={`박스 ${box.boxNo} 파렛트 배정 선택`} checked={selected.has(box.boxNo)} onChange={(event) => selectBox(box.boxNo, event.target.checked)} disabled={!editable || isPending || guard.busy} className="size-3.5 accent-primary" /></td><td className="px-3 py-3 font-medium">{box.boxNo}</td><td className="px-3 py-3 text-xs leading-5">{products.map((product) => <span key={product.id} className="block"><span data-no-translate>{product.identity}</span> <span>({product.quantity.toLocaleString('ko-KR')}개)</span></span>)}</td><td className="px-3 py-3 text-right tabular-nums">{quantity.toLocaleString('ko-KR')}개</td><td className="px-3 py-3 text-right text-xs text-muted-foreground">{formatChinaOutboundBoxDimensions(box) ?? '미입력'}</td><td className="px-3 py-3 text-right tabular-nums">{formatChinaOutboundCbm(cbm) ?? '-'}</td><td className="px-3 py-2"><input aria-label={`박스 ${box.boxNo} 파렛트 번호`} value={palletNumbers[box.boxNo] ?? ''} onChange={(event) => setPalletNumbers((current) => ({ ...current, [box.boxNo]: event.target.value }))} disabled={!editable || isPending || guard.busy} className={`${compactInputClass} mx-auto max-w-32 text-center`} placeholder="예: 1" /></td></tr>
    })}</tbody></table></div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-4 py-3"><p className="text-xs text-muted-foreground">빈칸으로 저장하면 파렛트 배정을 해제합니다. 파렛트 번호는 숫자뿐 아니라 `A`, `B`, `1-2`처럼 자유롭게 입력할 수 있습니다.</p><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">선택 {selected.size.toLocaleString('ko-KR')}개</span><button type="button" aria-label="파렛트 배정 선택 저장" disabled={!editable || isPending || guard.busy || !selected.size} onClick={() => void guard.runTask(() => saveDraft([...selected]))} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"><Check className="size-3.5" /> 선택 저장</button><button type="button" aria-label="파렛트 배정 전체 저장" disabled={!editable || isPending || guard.busy} onClick={() => void guard.runTask(() => saveDraft())} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"><Check className="size-3.5" /> 전체 저장</button></div></div>
  </section>
}

function WorkbookActions({ shipmentId, editable }: {
  shipmentId: string
  editable: boolean
}) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<WorkbookPreview | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  async function uploadWorkbook(mode: 'preview' | 'apply') {
    if (!selectedFile) { toast.error('업로드할 엑셀 파일을 선택해주세요.'); return false }
    if (mode === 'apply' && (!preview || preview.errors.length > 0)) {
      toast.error('엑셀을 먼저 검토하고 오류를 해결한 뒤 반영해주세요.')
      return false
    }
    if (mode === 'apply' && (guard.hasDraftKind('box') || guard.hasDraftKind('pallet'))) {
      toast.error('직접 입력한 박스·파렛트 초안을 먼저 확인하고 저장하거나 취소해주세요.')
      return false
    }
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
        return false
      }
      if (mode === 'preview') {
        toast.success(body.preview?.errors.length ? '엑셀에서 확인할 항목을 찾았습니다.' : '엑셀 검토가 끝났습니다. 반영할 수 있습니다.')
      } else {
        toast.success('엑셀 작업 내용을 반영했습니다.')
        setSelectedFile(null)
        setPreview(null)
        guard.setDraft('workbook', null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        router.refresh()
      }
      return true
    } catch {
      toast.error('엑셀 업로드 중 연결 오류가 발생했습니다.')
      return false
    } finally {
      setIsWorking(false)
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0] ?? null)
    setPreview(null)
  }

  function clearWorkbook() {
    setSelectedFile(null)
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useChinaWorkDraft('workbook', selectedFile ? {
    kind: 'workbook', label: '엑셀 검토 결과', snapshot: selectedFile, save: () => uploadWorkbook('apply'), discard: clearWorkbook,
  } : null)

  const toolbar = (
    <>
      <a
        href={'/api/purchasing/china-shipments/' + encodeURIComponent(shipmentId) + '/workbook'}
        className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
      >
        <Download className="size-4" />
        작업용 엑셀
      </a>
      <label className={'inline-flex h-9 max-w-48 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted ' + (!editable ? 'pointer-events-none opacity-50' : '')}>
        <Upload className="size-4 shrink-0" />
        <span className="truncate">{selectedFile ? selectedFile.name : '엑셀 선택'}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={chooseFile}
          disabled={!editable || isWorking}
          className="sr-only"
        />
      </label>
      {selectedFile ? <button type="button" disabled={isWorking} onClick={clearWorkbook} className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">선택 취소</button> : null}
      <button type="button" disabled={!editable || isWorking || !selectedFile} onClick={() => void guard.runTask(() => uploadWorkbook('preview'))} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">
        {isWorking ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
        엑셀 검토
      </button>
      {preview ? <div className={'basis-full w-full rounded-md border px-3 py-2 text-xs ' + (preview.errors.length ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>박스분할 {preview.summary.boxSplitItemCount.toLocaleString('ko-KR')}개 품목 · {preview.summary.boxSplitRowCount.toLocaleString('ko-KR')}개 행 · 파렛트 배정 {preview.summary.palletAssignmentCount.toLocaleString('ko-KR')}건</p>
          {preview.errors.length === 0 ? <button type="button" disabled={!editable || isWorking || !selectedFile} onClick={() => void guard.runTask(() => uploadWorkbook('apply'))} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isWorking ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} 검토 결과 반영</button> : null}
        </div>
        {preview.errors.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-4">{preview.errors.slice(0, 10).map((error, index) => <li key={error.sheet + ':' + error.row + ':' + index}>{error.sheet}{error.row ? ' ' + error.row + '행' : ''}: {error.message}</li>)}{preview.errors.length > 10 ? <li>외 {preview.errors.length - 10}건</li> : null}</ul> : null}
      </div> : null}
    </>
  )

  return toolbar
}

export type SavedBoxSummary = {
  box: ChinaShipmentDetailView['boxes'][number]
  palletNo: string | null
  quantity: number
  items: Array<{ item: ChinaShipmentDetailView['items'][number]; quantity: number }>
}

function buildSavedBoxSummaries({ boxes, boxItemsByBox, itemById, palletById }: {
  boxes: ChinaShipmentDetailView['boxes']
  boxItemsByBox: Map<string, ChinaShipmentDetailView['boxItems']>
  itemById: Map<string, ChinaShipmentDetailView['items'][number]>
  palletById: Map<string, ChinaShipmentDetailView['pallets'][number]>
}): SavedBoxSummary[] {
  return [...boxes].sort((left, right) => left.boxNo.localeCompare(right.boxNo, 'ko-KR', { numeric: true })).map((box) => {
    const itemQuantities = new Map<string, { item: ChinaShipmentDetailView['items'][number]; quantity: number }>()
    const allocations = boxItemsByBox.get(box.id) ?? []
    for (const allocation of allocations) {
      const item = itemById.get(allocation.shipmentItemId)
      if (!item) continue
      const current = itemQuantities.get(item.id)
      itemQuantities.set(item.id, { item, quantity: (current?.quantity ?? 0) + allocation.quantity })
    }
    return {
      box,
      palletNo: box.palletId ? palletById.get(box.palletId)?.palletNo ?? null : null,
      quantity: allocations.reduce((total, allocation) => total + allocation.quantity, 0),
      items: [...itemQuantities.values()].sort((left, right) => compareShipmentItems(left.item, right.item)),
    }
  })
}

export type PalletSummary = {
  pallet: ChinaShipmentDetailView['pallets'][number]
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
  const grouped = new Map<string, ChinaShipmentDetailView['boxes']>()
  for (const box of boxes) {
    const pallet = box.palletId ? palletById.get(box.palletId) : null
    if (!pallet) continue
    grouped.set(pallet.id, [...(grouped.get(pallet.id) ?? []), box])
  }
  return pallets.flatMap((pallet) => {
    const palletBoxes = grouped.get(pallet.id)
    if (!palletBoxes) return []
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
    return [{ pallet, palletNo: pallet.palletNo, boxes: palletBoxes.sort((left, right) => left.boxNo.localeCompare(right.boxNo, 'ko-KR', { numeric: true })), quantity, cbm, boxesWithoutDimensions, products: [...products.values()].sort(compareShipmentItems) }]
  }).sort((left, right) => left.palletNo.localeCompare(right.palletNo, 'ko-KR', { numeric: true }))
}

function EmptyStage({ title, description, onMove, moveLabel }: { title: string; description: string; onMove: () => void; moveLabel: string }) {
  return <section className="rounded-lg border border-dashed p-8 text-center"><h3 className="font-semibold">{title}<TitleHelp title={title}>{description}</TitleHelp></h3><button type="button" onClick={onMove} className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">{moveLabel}</button></section>
}

function StageButton({ active, step, title, detail, onClick }: { active: boolean; step: string; title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-current={active ? 'step' : undefined} className={`flex min-h-16 flex-col items-center justify-center rounded-md border px-2 py-1.5 text-center transition-colors ${active ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-transparent bg-background hover:border-border hover:bg-muted'}`}><p className={`text-[11px] leading-tight ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{step}</p><p className="mt-0.5 text-sm font-semibold leading-tight">{title}</p><p className={`mt-0.5 text-[11px] leading-tight ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{detail}</p></button>
}

function ProgressBadge({ completed, detail }: { completed: boolean; detail: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${completed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{detail}</span>
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

function createBoxSplitDraft(): BoxSplitDraft {
  return { key: `box-${Date.now()}-${Math.random()}`, boxNo: '', quantity: '', lengthCm: '', widthCm: '', heightCm: '' }
}

function asBoxSplitDraftSnapshot(value: unknown): BoxSplitDraftSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const snapshot = value as Partial<BoxSplitDraftSnapshot>
  if (!Array.isArray(snapshot.drafts) || !Array.isArray(snapshot.baseline)) return null
  return {
    drafts: snapshot.drafts as BoxSplitDraft[],
    baseline: snapshot.baseline as BoxSplitDraft[],
    status: snapshot.status === 'completed' || snapshot.status === 'in_progress' ? snapshot.status : undefined,
    baselineStatus: snapshot.baselineStatus === 'completed' || snapshot.baselineStatus === 'in_progress' ? snapshot.baselineStatus : undefined,
  }
}

function cloneBoxSplitDrafts(drafts: BoxSplitDraft[]) {
  return drafts.map((draft) => ({ ...draft }))
}

function boxDraftValues(drafts: BoxSplitDraft[]) {
  return JSON.stringify(drafts.map(({ boxNo, quantity, lengthCm, widthCm, heightCm }) => ({ boxNo, quantity, lengthCm, widthCm, heightCm })))
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
