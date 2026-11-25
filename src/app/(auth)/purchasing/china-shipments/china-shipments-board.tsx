'use client'

import { ItemCodeCell } from './item-code-cell'
import { normalizeChinaPalletNumber } from '@/lib/purchasing/china-pallet-number'

import { type ChangeEvent, type FormEvent, type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from 'react'
import { nextAvailableBoxNumbers, planAutomaticBoxSplit, type InspectionPackingPiece } from '@/lib/purchasing/china-outbound-auto-packing'
import { useRouter, useSearchParams } from 'next/navigation'
import { CircleAlert, Check, ChevronLeft, Download, FileSpreadsheet, Loader2, PackagePlus, Plus, Send, Trash2, Upload, X } from 'lucide-react'
import type { ChinaOutboundBoxSplitSavedState } from '@/lib/purchasing/china-outbound-save-state'
import { applyChinaShipmentBoxSplitSavedState } from './china-shipment-save-state'
import { Dialog } from '@base-ui/react/dialog'
import { toast } from 'sonner'
import { fillChinaOutboundDimensionInputs, calculateChinaOutboundBoxCbm, formatChinaOutboundBoxDimensions, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { CHINA_OUTBOUND_DESTINATIONS } from '@/lib/purchasing/china-outbound-destinations'
import { CHINA_SHIPMENT_PERIODS, resolveChinaShipmentPeriod, withChinaShipmentPeriod, type ChinaShipmentPeriod } from '@/lib/purchasing/china-shipment-period'
import { useChinaWorkNavigation } from './china-work-navigation'
import { PurchasingProductImageButton } from '@/components/purchasing-product-image'
import type { ProductImageResult } from '@/lib/purchasing/product-image-catalogue'
import { TitleHelp } from './title-help'
import { ChineseNameEditor } from './outbound-package-editors'
import { matchesChinaStockPeriod } from '@/lib/purchasing/china-outbound-packaging'
import { ManualSamplePanel } from './manual-sample-panel'
import { PalletContentsPanel } from './pallet-contents-panel'
import { ChinaShipmentStockTable } from './china-shipment-stock-table'
import { SavedBoxContentsPanel } from './saved-box-contents-panel'
import { ShipmentLabelMenu } from './shipment-label-menu'
import { ChinaShipmentExcelDialog } from './china-shipment-excel-dialog'
import { ChinaShipmentWarehouseDialog, type ChinaOutboundWarehouseView } from './china-shipment-warehouse-dialog'
import { ChinaWorkGuardProvider, useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import {
  applyChinaOutboundInventoryPackingAction,
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
  itemCategory?: string | null
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
  pallets: Array<{ id: string; palletNo: string; note: string | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; manualCbm?: number | null; grossWeightKg?: number | null; tareWeightKg?: number | null; completionStatus?: 'in_progress' | 'completed' | null }>
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
    manualCbm?: number | null
    grossWeightKg?: number | null
    inventoryPackingGroupKey?: string | null
    inventoryPackingGroupBoxIndex?: number | null
  }>
  boxItems: Array<{ id: string; boxId: string; shipmentItemId: string; quantity: number; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; manualCbm?: number | null; grossWeightKg?: number | null }>
}

type BoxSplitDraft = { key: string; boxNo: string; quantity: string; lengthCm: string; widthCm: string; heightCm: string; manualCbm: string; grossWeightKg: string; boxId?: string; autoNumber?: boolean }
type BoxSplitStatus = 'in_progress' | 'completed'
type BoxSplitDraftSnapshot = {
  drafts: BoxSplitDraft[]
  baseline: BoxSplitDraft[]
  status?: BoxSplitStatus
  baselineStatus?: BoxSplitStatus
}

type WorkbookPreview = {
  boxSplits: Array<{ shipmentItemId: string; allocations: Array<{ boxNo: string; quantity: number }> }>
  palletAssignments: Array<{ boxNo: string; palletNo: string | null }>
  summary: { boxSplitItemCount: number; boxSplitRowCount: number; palletAssignmentCount: number; boxCount: number }
  errors: Array<{ sheet: string; row: number; message: string }>
}

const inputClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60'
const compactInputClass = 'h-8 w-full rounded-md border bg-background px-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60'
const editableStatuses = new Set(['draft', 'packing'])
const BoxSplitSavedContext = createContext<(saved: ChinaOutboundBoxSplitSavedState) => void>(() => {})
const canDeleteShipment = (status: string) => ['draft', 'packing', 'ready', 'cancelled'].includes(status)

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
  initialInventoryId?: string
  outboundWarehouses?: ChinaOutboundWarehouseView[]
  listPeriod?: ChinaShipmentPeriod
}) {
  return <ChinaWorkGuardProvider key={props.showCreate ? `create:${props.initialInventoryId ?? ''}` : props.selectedShipment?.shipment.id ?? 'list'}><ChinaShipmentsBoardContent {...props} /></ChinaWorkGuardProvider>
}

function ChinaShipmentsBoardContent({
  inventoryItems,
  shipments,
  selectedShipment: serverSelectedShipment,
  selectedStep,
  showCreate,
  initialInventoryId,
  outboundWarehouses = [],
  listPeriod = resolveChinaShipmentPeriod({}, today()),
}: {
  inventoryItems: ChinaShipmentStockItem[]
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView | null
  selectedStep: ChinaShipmentStage
  showCreate: boolean
  initialInventoryId?: string
  outboundWarehouses?: ChinaOutboundWarehouseView[]
  listPeriod?: ChinaShipmentPeriod
}) {
  const guard = useChinaWorkGuard()
  const router = useRouter()
  const refreshRoute = router.refresh
  const { busy: workBusy, hasDraftKind } = guard
  const navigateChinaWork = useChinaWorkNavigation()
  const searchParams = useSearchParams()
  const stepParam = searchParams.get('step')
  const requestedStep = stepParam ?? selectedStep
  const activeStep = requestedStep === 'summary' || requestedStep === 'pallets' || requestedStep === 'boxes' ? requestedStep : 'items'
  const [serverSnapshot, setServerSnapshot] = useState(serverSelectedShipment)
  const [selectedShipment, setSelectedShipment] = useState(serverSelectedShipment)
  const [saveGeneration, setSaveGeneration] = useState(0)
  const [refreshedGeneration, setRefreshedGeneration] = useState(0)
  const [refreshGeneration, setRefreshGeneration] = useState<number | null>(null)
  const backgroundRefresh = useRef<{ generation: number } | null>(null)
  const pendingRefresh = useRef(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  if (serverSnapshot !== serverSelectedShipment) {
    setServerSnapshot(serverSelectedShipment)
    if (refreshGeneration === null || refreshGeneration === saveGeneration) {
      setSelectedShipment(serverSelectedShipment)
      setRefreshedGeneration(saveGeneration)
    } else {
      // A second save finished while this older page request was in flight.
      setRefreshRevision((current) => current + 1)
    }
    setRefreshGeneration(null)
  }
  const acceptSavedState = useCallback((saved: ChinaOutboundBoxSplitSavedState) => {
    setSaveGeneration((current) => current + 1)
    setSelectedShipment((current) => applyChinaShipmentBoxSplitSavedState(current, saved))
    setRefreshRevision((current) => current + 1)
  }, [])
  useEffect(() => { backgroundRefresh.current = null }, [serverSnapshot])
  useEffect(() => { pendingRefresh.current = refreshedGeneration < saveGeneration }, [refreshedGeneration, saveGeneration])
  useEffect(() => {
    if (refreshedGeneration >= saveGeneration) return
    let timer: ReturnType<typeof setTimeout>
    function refreshWhenIdle() {
      if (refreshedGeneration >= saveGeneration) return
      if (workBusy || hasDraftKind('box') || hasDraftKind('pallet') || backgroundRefresh.current) {
        timer = setTimeout(refreshWhenIdle, 500)
        return
      }
      backgroundRefresh.current = { generation: saveGeneration }
      setRefreshGeneration(saveGeneration)
      // Refresh the browser cache after the save is already visible and unlocked.
      refreshRoute()
    }
    timer = setTimeout(refreshWhenIdle, 1_000)
    return () => clearTimeout(timer)
  }, [refreshRevision, workBusy, hasDraftKind, refreshRoute, saveGeneration, refreshedGeneration])
  useEffect(() => () => {
    if (pendingRefresh.current && !backgroundRefresh.current) refreshRoute()
  }, [refreshRoute])
  const [isPending, startTransition] = useTransition()
  const [isSelecting, startSelecting] = useTransition()
  const [initialDate] = useState(() => today())
  const createdShipmentId = useRef<string | null>(null)
  const creationMayExist = useRef(false)
  const initialInventory = initialInventoryId ? inventoryItems.find((item) => item.id === initialInventoryId && item.availableQuantity > 0) : undefined
  const [stockSearch, setStockSearch] = useState(initialInventory?.sku ?? '')
  const [stockCategory, setStockCategory] = useState('')
  const [selectedWarehouseCodes, setSelectedWarehouseCodes] = useState<string[]>(initialInventory ? [initialInventory.warehouseCode] : [])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [destinationName, setDestinationName] = useState('')
  const [plannedOutboundDate, setPlannedOutboundDate] = useState(today())
  const [displayName, setDisplayName] = useState(() => defaultShipmentDisplayName(today()))
  const [displayNameIsDateDefault, setDisplayNameIsDateDefault] = useState(true)
  const [memo, setMemo] = useState('')

  const availableInventory = inventoryItems.filter((item) => item.availableQuantity > 0)
  const availableQuantityByWarehouse = new Map<string, number>()
  for (const item of availableInventory.filter((item) => !stockCategory || stockItemCategory(item) === stockCategory)) {
    availableQuantityByWarehouse.set(item.warehouseCode, (availableQuantityByWarehouse.get(item.warehouseCode) ?? 0) + item.availableQuantity)
  }
  const warehouseOptions = [...new Set([
    ...outboundWarehouses.map((warehouse) => warehouse.warehouseCode),
    ...inventoryItems.map((item) => item.warehouseCode),
  ])]
    .sort((left, right) => left.localeCompare(right, 'ko-KR', { numeric: true }))
  const selectedWarehouseInventory = availableInventory.filter((item) => selectedWarehouseCodes.includes(item.warehouseCode))
  const allWarehouseSelected = warehouseOptions.length > 0 && warehouseOptions.every((warehouseCode) => selectedWarehouseCodes.includes(warehouseCode))
  const stockSearchKeyword = stockSearch.trim().toLocaleLowerCase('ko-KR')
  const shownInventory = selectedWarehouseInventory
    .filter((item) => !stockCategory || stockItemCategory(item) === stockCategory)
    .filter((item) => !stockSearchKeyword || [item.sku, item.productName, item.optionName ?? '']
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
      if (await guard.runTask(saveNewShipment) && createdShipmentId.current) navigateChinaWork(shipmentHref(createdShipmentId.current, 'items'), { replace: true })
    })
  }

  return (
    <BoxSplitSavedContext.Provider value={acceptSavedState}><fieldset data-purchasing-translate disabled={isPending || isSelecting || guard.busy} className="min-w-0 space-y-4 border-0 p-0" aria-busy={isPending || isSelecting || guard.busy}>
      {isSelecting && <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />출고요청 불러오는 중</p>}
      <div className="space-y-3">
        <ShipmentSelector
          key={`selector:${showCreate ? 'new-shipment' : selectedShipment?.shipment.id ?? 'no-shipment'}:${listPeriod.preset}:${listPeriod.from}:${listPeriod.to}`}
          shipments={shipments}
          selectedShipment={showCreate ? null : selectedShipment?.shipment ?? null}
          showCreate={showCreate}
          outboundWarehouses={outboundWarehouses}
          listPeriod={listPeriod}
          onBack={() => guard.requestNavigation(() => startSelecting(() => navigateChinaWork('/purchasing/china-shipments')))}
          onToggleCreate={() => guard.requestNavigation(() => navigateChinaWork(showCreate ? '/purchasing/china-shipments' : '/purchasing/china-shipments?create=1'))}
          onSelect={(id) => {
            if (id !== selectedShipment?.shipment.id) guard.requestNavigation(() => startSelecting(() => navigateChinaWork(shipmentHref(id, 'items'))))
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
                {warehouseOptions.length === 0 && <p className="text-sm text-muted-foreground">등록된 출고 창고가 없습니다.</p>}
              </div>
              <StockCategoryFilter items={selectedWarehouseCodes.length ? selectedWarehouseInventory : availableInventory} value={stockCategory} onChange={setStockCategory} />
            </section>

            <section className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">출고할 상품과 수량<TitleHelp title="출고할 상품과 수량">출고할 재고 위치를 하나 이상 체크해주세요.</TitleHelp></h3>
                </div>
                <button type="button" onClick={fillAllOutboundQuantities} disabled={shownInventory.length === 0} className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">보이는 상품 전체수량</button>
              </div>
              {stagedShipmentLines.length > 0 ? <p className="mt-3 text-xs font-medium text-primary">입력된 출고수량: {stagedShipmentLines.length.toLocaleString('ko-KR')}개 품목 · 전체 {stagedOutboundQuantity.toLocaleString('ko-KR')}개</p> : null}
              {selectedWarehouseInventory.length > 0 ? (
                <>
                  <input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} className="mt-3 h-9 w-full rounded-md border bg-background px-3 text-sm sm:max-w-sm" placeholder="상품명, 상품코드, 옵션 검색" />
                  <div className="mt-3">
                    <p className="mb-2 text-xs text-muted-foreground">중국재고의 박스수량으로 박스를 자동 생성하고, 무게·CBM 합계를 박스 수로 나눠 채웁니다. 생성된 박스는 수정할 수 있습니다.</p>
                    <ChinaShipmentStockTable items={shownInventory} quantities={quantities}
                      onQuantityChange={(inventoryId, value) => setQuantities((current) => ({ ...current, [inventoryId]: value }))}
                      quantityLabel="이번 출고" tableLabel="신규 출고 상품 목록" emptyMessage="조건에 맞는 작업 가능 재고가 없습니다."
                      categoryForItem={stockItemCategory} disabled={isPending || isSelecting || guard.busy} />
                  </div>
                </>
              ) : <p className="mt-3 rounded-md border border-dashed bg-background px-3 py-10 text-center text-sm text-muted-foreground">
                {selectedWarehouseCodes.length > 0
                  ? '선택한 창고에 작업 가능한 SaaS 재고가 없습니다.'
                  : '출고할 재고 위치를 하나 이상 체크하면 해당 창고의 상품과 작업 가능 수량이 나옵니다.'}
              </p>}
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
            window.history.pushState(null, '', withChinaShipmentPeriod(shipmentHref(selectedShipment.shipment.id, stage), searchParams.toString()))
          })}
        /> : null}
      </div>
    </fieldset></BoxSplitSavedContext.Provider>
  )
}

function ShipmentSelector({ shipments, selectedShipment, showCreate, outboundWarehouses, listPeriod, onBack, onToggleCreate, onSelect }: {
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView['shipment'] | null
  showCreate: boolean
  outboundWarehouses: ChinaOutboundWarehouseView[]
  listPeriod: ChinaShipmentPeriod
  onBack: () => void
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
  const [periodPreset, setPeriodPreset] = useState(listPeriod.preset)
  const [periodFrom, setPeriodFrom] = useState(listPeriod.from)
  const [periodTo, setPeriodTo] = useState(listPeriod.to)
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<string[]>([])
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  const [deleteSummary, setDeleteSummary] = useState('')
  const [deleteFailures, setDeleteFailures] = useState<Array<{ id: string; name: string; error: string }>>([])
  const listedShipments = shipments
  const visibleShipments = listedShipments.filter((shipment) => !deletedIds.includes(shipment.id))
  const deletableShipments = visibleShipments.filter((shipment) => canDeleteShipment(shipment.status))
  const selectedDeleteShipments = deletableShipments.filter((shipment) => selectedDeleteIds.includes(shipment.id))
  const allDeleteSelected = deletableShipments.length > 0 && selectedDeleteShipments.length === deletableShipments.length

  function deleteSelectedShipments() {
    const targets = [...selectedDeleteShipments]
    if (!targets.length || isPending || guard.busy) return
    guard.requestConfirmation({
      title: '선택한 출고작업 삭제',
      description: <>
        <span className="block">선택한 출고작업의 예약 재고를 해제하고 박스·파렛트·적재 기록을 삭제합니다. 삭제 후에는 되돌릴 수 없습니다.</span>
        <ul className="mt-3 max-h-40 list-disc space-y-1 overflow-y-auto pl-5">
          {targets.map((shipment) => <li key={shipment.id} data-no-translate>{shipmentDisplayName(shipment)} · {shipment.shipmentNo}</li>)}
        </ul>
      </>,
      confirmLabel: '삭제',
      destructive: true,
      onConfirm: () => guard.requestNavigation(() => startTransition(async () => {
        await guard.runTask(async () => {
          setDeleteSummary('')
          setDeleteFailures([])
          const deleted: string[] = []
          const failures: Array<{ id: string; name: string; error: string }> = []
          for (const shipment of targets) {
            try {
              const result = await deleteChinaOutboundShipmentAction({ shipmentId: shipment.id })
              if (result.ok) deleted.push(shipment.id)
              else failures.push({ id: shipment.id, name: shipmentDisplayName(shipment), error: result.error })
            } catch {
              failures.push({ id: shipment.id, name: shipmentDisplayName(shipment), error: '삭제 결과를 확인하지 못했습니다. 목록을 새로고침한 뒤 다시 확인해주세요.' })
            }
          }
          setDeletedIds((current) => [...new Set([...current, ...deleted])])
          setSelectedDeleteIds(failures.map((failure) => failure.id))
          setDeleteFailures(failures)
          if (deleted.length) {
            const message = `${deleted.length.toLocaleString('ko-KR')}건 삭제 완료`
            setDeleteSummary(message)
            toast.success(message)
          }
          if (failures.length) toast.error('삭제하지 못한 출고작업')
          router.refresh()
          return failures.length === 0
        })
      })),
    })
  }

  function searchPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const range = resolveChinaShipmentPeriod({ period: periodPreset, from: periodFrom, to: periodTo }, today())
    if (range.error) { toast.error(range.error); return }
    const params = new URLSearchParams({ period: range.preset })
    if (range.preset === 'custom') { params.set('from', range.from); params.set('to', range.to) }
    if (showCreate) params.set('create', '1')
    guard.requestNavigation(() => startTransition(() => navigateChinaWork(`/purchasing/china-shipments?${params}`)))
  }
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
    if (!selectedShipment || !canDeleteShipment(selectedShipment.status) || isPending || guard.busy) return
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
        if (deleted) navigateChinaWork('/purchasing/china-shipments', { replace: true })
        })
      })
    })
  }

  return (
    <section className={selectedShipment ? '' : 'rounded-md border bg-card p-3'} aria-busy={isPending}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {selectedShipment ? (
          <button type="button" disabled={isPending} onClick={onBack} className="mr-auto inline-flex h-9 items-center justify-center gap-1 rounded-md border bg-muted/50 px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"><ChevronLeft className="size-4" />목록으로</button>
        ) : <>
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{showCreate ? '새 중국출고요청' : '중국출고요청 목록'}</h2>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!showCreate && <><ChinaShipmentExcelDialog onApplied={(shipmentId) => {
            if (shipmentId) guard.requestNavigation(() => navigateChinaWork(shipmentHref(shipmentId, 'items')))
          }} />
          <ChinaShipmentWarehouseDialog warehouses={outboundWarehouses} /></>}
          <button type="button" disabled={isPending} onClick={onToggleCreate} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"><PackagePlus className="size-4" /> {showCreate ? '요청 닫기' : '새 중국출고요청'}</button>
        </div>
        </>}
        {selectedShipment ? <div className="flex shrink-0 gap-2">
          <button type="button" disabled={isPending} onClick={() => isEditing ? guard.requestNavigation(() => setIsEditing(false), ['details']) : setIsEditing(true)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60 sm:flex-none">{isEditing ? '수정 닫기' : '이름·날짜 수정'}</button>
          <button type="button" disabled={isPending || guard.busy || !canDeleteShipment(selectedShipment.status)} onClick={deleteShipment} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"><Trash2 className="size-4" /> 삭제</button>
        </div> : null}
      </div>
      {!selectedShipment && !showCreate && <>
      <form onSubmit={searchPeriod} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="space-y-1 text-xs">
          <span>조회 기간</span>
          <select value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value as ChinaShipmentPeriod['preset'])} className={inputClass}>
            {CHINA_SHIPMENT_PERIODS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          </select>
        </label>
        {periodPreset === 'custom' ? <>
          <label className="space-y-1 text-xs"><span>조회 시작일</span><input type="date" required value={periodFrom} max={periodTo || undefined} onChange={(event) => setPeriodFrom(event.target.value)} className={inputClass} /></label>
          <label className="space-y-1 text-xs"><span>조회 종료일</span><input type="date" required value={periodTo} min={periodFrom || undefined} onChange={(event) => setPeriodTo(event.target.value)} className={inputClass} /></label>
        </> : <p data-no-translate className="pb-2 text-xs text-muted-foreground">{listPeriod.from} ~ {listPeriod.to}</p>}
        <button type="submit" disabled={isPending} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">조회</button>
      </form>
      {listPeriod.error && <p role="alert" className="mt-2 text-sm text-red-700">{listPeriod.error}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">출고완료 작업은 삭제할 수 없습니다.</p>
        <button type="button" disabled={isPending || guard.busy || selectedDeleteShipments.length === 0} onClick={deleteSelectedShipments}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}선택 삭제 {selectedDeleteShipments.length.toLocaleString('ko-KR')}
        </button>
      </div>
      {deleteSummary && <p role="status" className="mt-2 text-sm text-emerald-700">{deleteSummary}</p>}
      {deleteFailures.length > 0 && <div role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <p className="font-medium">삭제하지 못한 출고작업</p>
        <ul className="mt-1 space-y-1">{deleteFailures.map((failure) => <li key={failure.id}><span data-no-translate>{failure.name}</span> · {failure.error}</li>)}</ul>
      </div>}
      <div className="mt-3 max-h-[360px] overflow-auto rounded-md border">
        <table className="w-full min-w-[760px] text-left text-sm" aria-label="중국출고요청 목록">
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground"><tr>
            <th className="w-10 px-3 py-2 text-center"><input type="checkbox" aria-label="삭제 가능한 중국출고 전체 선택" checked={allDeleteSelected}
              ref={(element) => { if (element) element.indeterminate = selectedDeleteShipments.length > 0 && !allDeleteSelected }}
              disabled={isPending || guard.busy || deletableShipments.length === 0}
              onChange={(event) => setSelectedDeleteIds(event.target.checked ? deletableShipments.map((shipment) => shipment.id) : [])} /></th>
            {['출고작업명', '요청일', '출고예정일', '도착지', '상태', '상품 수', '출고수량', '포장수량'].map((label) => <th key={label} className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}
          </tr></thead>
          <tbody>{visibleShipments.length === 0 ? <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">선택한 기간에 중국출고요청이 없습니다.</td></tr> : visibleShipments.map((shipment) => {
            const canDelete = deletableShipments.some((entry) => entry.id === shipment.id)
            return <tr key={shipment.id} className={`border-t hover:bg-muted/30 ${canDelete && selectedDeleteIds.includes(shipment.id) ? 'bg-red-50/50' : ''}`}>
              <td className="px-3 py-2 text-center"><input type="checkbox" aria-label={`${shipment.shipmentNo} 삭제 선택`}
                title={canDelete ? undefined : '출고완료 작업은 삭제할 수 없습니다.'}
                checked={canDelete && selectedDeleteIds.includes(shipment.id)} disabled={isPending || guard.busy || !canDelete}
                onChange={(event) => setSelectedDeleteIds((current) => event.target.checked ? [...current, shipment.id] : current.filter((id) => id !== shipment.id))} /></td>
              <td className="px-3 py-2">
                <button type="button" disabled={isPending} onClick={() => onSelect(shipment.id)}
                  data-no-translate className="text-left font-medium text-blue-700 underline-offset-2 hover:underline disabled:opacity-50">{shipmentDisplayName(shipment)}</button>
                <p data-no-translate className="mt-0.5 text-xs text-muted-foreground">{shipment.shipmentNo}</p>
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums" data-no-translate>{new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(shipment.createdAt))}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums" data-no-translate>{shipment.plannedOutboundDate || '-'}</td>
              <td className="px-3 py-2" data-no-translate>{shipment.destinationName || '-'}</td>
              <td className="whitespace-nowrap px-3 py-2"><StatusBadge status={shipment.status} /></td>
              <td className="px-3 py-2 text-right tabular-nums">{shipment.itemCount.toLocaleString('ko-KR')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{shipment.reservedQuantity.toLocaleString('ko-KR')}</td>
              <td className="px-3 py-2 text-right tabular-nums">{shipment.packedQuantity.toLocaleString('ko-KR')}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {shipments.length !== listedShipments.length ? <p className="mt-2 text-xs text-muted-foreground">취소된 출고작업 {(shipments.length - listedShipments.length).toLocaleString('ko-KR')}건은 목록에서 숨겼습니다.</p> : null}
      </>}
      {isEditing && selectedShipment ? <form onSubmit={saveShipmentDetails} className="mt-3 grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-end">
        <Field label="출고작업명"><input value={draftDisplayName} onChange={(event) => setDraftDisplayName(event.target.value)} className={inputClass} placeholder="예: 2026-10-01 중국출고" /></Field>
        <Field label="출고예정일"><input type="date" value={draftPlannedOutboundDate} onChange={(event) => setDraftPlannedOutboundDate(event.target.value)} className={inputClass} /></Field>
        <div className="flex gap-2 sm:justify-end"><button type="button" disabled={isPending} onClick={() => { setDraftDisplayName(selectedShipment.displayName ?? defaultShipmentDisplayName(selectedShipment.plannedOutboundDate)); setDraftPlannedOutboundDate(selectedShipment.plannedOutboundDate ?? ''); setIsEditing(false) }} className="h-9 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-60">취소</button><button type="submit" disabled={isPending} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 저장</button></div>
      </form> : null}
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



  const [editorStage, setEditorStage] = useState(stage)

  if (!detail) return null

  const { shipment, items, pallets, boxes, boxItems } = detail
  const editable = editableStatuses.has(shipment.status)
  const itemById = new Map(items.map((item) => [item.id, item]))

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
  const looseBoxes = boxesWithItems.filter((box) => !box.palletId || !palletById.has(box.palletId))
  const hasUnassignedPalletBox = looseBoxes.length > 0
  const packageSummary = `${palletSummaries.length} PLT + ${looseBoxes.length} BOX, ${palletSummaries.length + looseBoxes.length} CTN`
  const cannotDispatch = items.length === 0 || hasIncompleteBoxSplit || items.some((item) => (boxItemsByItem.get(item.id) ?? []).reduce((sum, allocation) => sum + allocation.quantity, 0) !== item.reservedQuantity)
  const canDownloadPalletLabels = boxesWithItems.some((box) => box.palletId && palletById.has(box.palletId))
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
      <div className="flex flex-col gap-3 border-b pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold">{shipmentDisplayName(shipment)}</h2>
            <StatusBadge status={shipment.status} />
            <span className="text-sm text-muted-foreground">{shipment.plannedOutboundDate || '날짜 미입력'} · {shipment.originWarehouseCode} → {shipment.destinationName || '도착지 미입력'}</span>
            <span className="text-xs text-muted-foreground">{shipment.shipmentNo} · 상품 {items.length.toLocaleString('ko-KR')}종 · 출고 {totalOutboundQuantity.toLocaleString('ko-KR')}개 · 포장 {totalPackedQuantity.toLocaleString('ko-KR')}개</span>
          </div>
          {shipment.memo ? <p className="mt-1 text-xs text-muted-foreground">메모: {shipment.memo}</p> : null}
        </div>

      </div>

      <nav className="grid gap-1 rounded-lg border bg-muted/20 p-1 sm:grid-cols-2 xl:grid-cols-4" aria-label="중국출고 작업 단계">
        <StageButton active={stage === 'items'} step="1단계" title="출고품목·박스분할" detail={`${items.length.toLocaleString('ko-KR')}종 · ${totalPackedQuantity.toLocaleString('ko-KR')} / ${totalOutboundQuantity.toLocaleString('ko-KR')}개`} onClick={() => onStageChange('items')} />
        <StageButton active={stage === 'boxes'} step="2단계" title="저장된 박스현황" detail="" onClick={() => onStageChange('boxes')} />
        <StageButton active={stage === 'pallets'} step="3단계" title="파렛트 배정" detail="" onClick={() => onStageChange('pallets')} />
        <StageButton active={stage === 'summary'} step="4단계" title="파렛트 최종 리스트" detail={packageSummary} onClick={() => onStageChange('summary')} />
      </nav>

      {stage === 'items' ? <section className="space-y-3">
        <ManualSamplePanel shipmentId={shipment.id} defaultWarehouseCode={shipment.originWarehouseCode} warehouseCodes={[...new Set([...warehouseCodes, ...inventoryItems.map((item) => item.warehouseCode)])]} editable={editable} isPending={isPending}>
          {(sampleButton, sampleForm) => <ShipmentItemAdditionPanel shipmentId={shipment.id} inventoryItems={inventoryItems}
            warehouseCodes={warehouseCodes} editable={editable} isPending={isPending} sampleButton={sampleButton} sampleForm={sampleForm} />}
        </ManualSamplePanel>
        {editable && hasIncompleteBoxSplit && <ApplyInventoryPackingButton shipmentId={shipment.id} isPending={isPending} />}
        <OutboundItemsPanel detail={detail} editable={editable} isPending={isPending} boxItemsByItem={boxItemsByItem} />
        <div className="flex justify-end"><button type="button" disabled={isPending || guard.busy || !boxesWithItems.length} onClick={() => onStageChange('boxes')} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">다음: 저장된 박스현황</button></div>
      </section> : null}

      {stage === 'boxes' ? <section className="space-y-3">

        <div className="flex items-center gap-2">
          <h3 className="font-semibold">2단계 · 저장된 박스현황</h3>
          <StageHelp label="박스현황 안내">
            <dl className="space-y-3">
              <div><dt className="font-medium">박스별 내용 확인</dt><dd className="text-muted-foreground">박스번호 순서대로 적재 상품을 확인하고 박스 규격과 중량을 수정하세요. 혼합박스는 같은 목록에 표시됩니다.</dd></div>
              <div><dt className="font-medium">박스 합치기</dt><dd className="text-muted-foreground">합칠 박스를 선택하고 상품 목록을 펼쳐 내용을 확인하세요.</dd></div>
            </dl>
          </StageHelp>
        </div>
        <SavedBoxContentsPanel shipmentId={shipment.id} summaries={savedBoxSummaries} editable={editable} isPending={isPending} />
        <div className="flex justify-end"><button type="button" disabled={isPending || guard.busy || !boxesWithItems.length} onClick={() => onStageChange('pallets')} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">다음: 파렛트 배정</button></div>
      </section> : null}

      {stage === 'pallets' ? <section className="space-y-4">
        <div className="flex flex-wrap justify-end gap-2"><a href={`/api/purchasing/china-shipments/${encodeURIComponent(shipment.id)}/pallet-worksheet`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm" title="페이지당 30박스 · 박스별 파레트 번호 수기 작성">파레트 작업지 인쇄</a><ShipmentLabelMenu shipmentId={shipment.id} kind="pallets" enabled={canDownloadPalletLabels} disabledReason="파레트에 박스를 배정해주세요." /></div>

        <div className="flex items-center gap-2">
          <h3 className="font-semibold">3단계 · 파렛트 배정</h3>
          <StageHelp label="파렛트 배정 안내" warning={hasIncompleteBoxSplit || hasUnassignedPalletBox}>
              <dl className="space-y-3">
                <div><dt className="font-medium">박스별 번호 입력</dt><dd className="mt-0.5 text-muted-foreground">번호를 입력한 뒤 오른쪽 파렛트 수정을 누르면 해당 박스가 저장됩니다.</dd></div>
                <div><dt className="font-medium">같은 파렛트에 적재</dt><dd className="mt-0.5 text-muted-foreground">같은 번호의 박스는 한 파렛트에 적재됩니다. 번호는 숫자나 문자를 쓸 수 있습니다.</dd></div>
                <div><dt className="font-medium">낱박스로 출고</dt><dd className="mt-0.5 text-muted-foreground">번호를 비워서 저장하면 배정이 해제됩니다.</dd></div>
              </dl>
              {hasIncompleteBoxSplit && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">박스에 담긴 수량과 실제 출고수량이 다른 품목이 있습니다. 박스분할 수량을 확인해주세요.</p>}
          </StageHelp>
        </div>
        {boxesWithItems.length === 0 ? <EmptyStage title="먼저 박스분할을 저장해주세요." description="1단계에서 출고품목별 박스 수량과 규격을 저장해주세요." onMove={() => onStageChange('items')} moveLabel="1단계로 이동" /> : <>
          <PalletAssignmentPanel shipmentId={shipment.id} boxes={boxesWithItems} boxItemsByBox={boxItemsByBox} itemById={itemById} palletById={palletById} editable={editable} isPending={isPending} />
        </>}
        <div className="flex justify-end"><button type="button" disabled={isPending || guard.busy || !boxesWithItems.length} onClick={() => onStageChange('summary')} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">다음: 파렛트 최종 리스트</button></div>
      </section> : null}

      {stage === 'summary' ? <section className="space-y-4">
        <div className="flex justify-end"><a href={`/api/purchasing/china-shipments/${encodeURIComponent(shipment.id)}/export`} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm"><Download className="size-4" />적재현황 엑셀</a></div>

        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2">
          <h3 className="font-semibold">4단계 · 파렛트 최종 리스트</h3>
          <StageHelp label="최종 리스트 안내" warning={hasIncompleteBoxSplit || hasUnassignedPalletBox}>
            <dl className="space-y-3">
              <div><dt className="font-medium">적재 내역 확인</dt><dd className="text-muted-foreground">파렛트를 펼치면 박스별 상품, 수량, 중량을 확인할 수 있습니다.</dd></div>
              <div><dt className="font-medium">CBM 비교</dt><dd className="text-muted-foreground">가로·세로·높이를 입력해 파렛트 CBM을 계산하고 제품 적재 CBM과 비교하세요.</dd></div>
              <div><dt className="font-medium">최종 적재리스트</dt><dd className="text-muted-foreground">파렛트별·박스별 적재 상품과 창고별 입고수량을 엑셀로 다운로드합니다.</dd></div>
            </dl>
            {hasIncompleteBoxSplit && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">박스에 담긴 수량과 실제 출고수량이 다른 품목이 있습니다. 박스분할 수량을 확인해주세요.</p>}
            {hasUnassignedPalletBox && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900">파렛트에 배정하지 않은 박스는 낱박스로 출고됩니다.</p>}
          </StageHelp>
        </div></div>
        {boxesWithItems.length > 0 ? <PalletContentsPanel shipmentId={shipment.id} summaries={palletSummaries} unassignedBoxes={looseBoxes} boxItems={detail.boxItems} items={items} editable={false} dimensionsEditable={editable} isPending={isPending} /> : <EmptyStage title="최종 확인할 박스가 없습니다." description="3단계에서 박스별 파렛트 번호를 입력하면 최종 적재리스트가 만들어집니다." onMove={() => onStageChange('pallets')} moveLabel="3단계로 이동" />}
        {(editable || shipment.status === 'ready') && <div className="flex items-center justify-between gap-4 border-t pt-4"><p className="text-xs text-muted-foreground">적재 내역과 서류를 모두 확인한 뒤 마지막에 출고완료를 눌러주세요. 재고가 차감됩니다.</p><button type="button" disabled={isPending || guard.busy || cannotDispatch} onClick={requestDispatch} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"><Send className="size-4" />출고완료</button></div>}

      </section> : null}

    </section>
  )
}

function StageHelp({ label, warning, children }: { label: string; warning?: boolean; children: ReactNode }) {
  return <details className="relative">
    <summary aria-label={label} className="flex size-7 cursor-pointer list-none items-center justify-center rounded-full hover:bg-muted [&::-webkit-details-marker]:hidden">
      <CircleAlert aria-hidden="true" className={warning ? 'size-4 text-amber-700' : 'size-4 text-muted-foreground'} />
    </summary>
    <div className="absolute left-0 z-30 mt-2 w-[min(22rem,65vw)] rounded-xl border bg-background p-4 text-sm shadow-xl">
      <h4 className="mb-3 font-semibold">{label}</h4>
      {children}
    </div>
  </details>
}

function ApplyInventoryPackingButton({ shipmentId, isPending }: { shipmentId: string; isPending: boolean }) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const [pending, start] = useTransition()
  const hasDrafts = guard.hasDraftKind('box') || guard.hasDraftKind('pallet') || guard.hasDraftKind('items')
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-3">
    <p className="text-xs text-muted-foreground">중국재고의 포장정보로 아직 담지 않은 수량만 자동 분할합니다. 저장된 박스는 유지됩니다.</p>
    <button type="button" disabled={isPending || pending || guard.busy || hasDrafts} onClick={() => start(async () => {
      await guard.runTask(async () => {
        const result = await applyChinaOutboundInventoryPackingAction({ shipmentId })
        if (!result.ok) { toast.error(result.error); return false }
        const summary = result.inventoryPacking
        if (summary?.appliedItemCount && summary.createdBoxCount) toast.success(`${summary.appliedItemCount}개 품목 · ${summary.createdBoxCount}박스에 중국재고 포장정보를 적용했습니다.`)
        else if (summary?.appliedItemCount) toast.success('기존 혼합박스에 포장정보를 적용했습니다.')
        else toast.success('자동 적용할 포장정보가 없습니다. 중국재고의 박스수량과 포장정보를 확인해주세요.')
        if (summary?.missingPackagingCount) toast.error(`포장정보가 없는 ${summary.missingPackagingCount}개 품목은 기존 상태로 유지했습니다.`)
        router.refresh()
        return true
      })
    })} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-sm font-medium hover:bg-blue-100 disabled:opacity-50">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}중국재고 포장정보 적용
    </button>
  </div>
}

function OutboundItemsPanel({ detail, editable, isPending, boxItemsByItem }: {
  detail: ChinaShipmentDetailView
  editable: boolean
  isPending: boolean
  boxItemsByItem: Map<string, ChinaShipmentDetailView['boxItems']>
}) {
  const { items, boxes } = detail
  const [editingId, setEditingId] = useState<string | null>(null)
  const sortedItems = [...items].sort(compareShipmentItemWorkProgress)
  const editingItem = items.find((item) => item.id === editingId)
  return <section className="overflow-hidden rounded-lg border">
    <div className="border-b bg-muted/20 px-4 py-3"><h3 className="font-semibold">1단계 · 출고품목·박스분할</h3></div>
    <div className="overflow-x-auto"><table className="min-w-[1220px] w-full table-fixed text-sm">
      <colgroup>{[94, 40, 180, 146, 150, 124, 84, 68, 70, 70, 116, 94].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>
        {['품목코드', '구분', '상품명', '중국어 상품명', '옵션', '현재고', '실제 출고수량', '분할 수량', '작업 상태', '박스 수', '입고 송장·포장정보', '관리'].map((label) => <th key={label} className={`whitespace-nowrap px-2 py-1.5 font-medium ${label === "현재고" ? "text-center" : "text-left"}`}>{label}</th>)}
      </tr></thead>
      <tbody>{sortedItems.map((item) => {
        const complete = item.packedQuantity === item.reservedQuantity
        const allocations = boxItemsByItem.get(item.id) ?? []
        const receipts = [...new Map((item.receiptPacking ?? []).map((piece) => [piece.receiptBoxId, piece])).values()]
        return <tr key={item.id} className="border-t align-middle">
          <td className="overflow-hidden px-1.5 py-0.5 text-xs font-medium"><ItemCodeCell code={item.sku} /></td><td className="px-2 py-0.5 whitespace-nowrap text-[10px] text-muted-foreground">{item.itemCategory || '상품'}</td><td className="px-2 py-0.5"><PurchasingProductImageButton shipmentItemId={item.id} productName={item.productName} imageData={item.productImage} /></td><td className="px-2 py-0.5"><ChineseNameEditor key={`${item.id}:${item.chineseProductName ?? ''}`} shipmentId={detail.shipment.id} item={item} editable={editable} isPending={isPending} /></td><td data-no-translate className="px-2 py-0.5 text-xs text-muted-foreground"><span className="block truncate" title={item.optionName || undefined}>{item.optionName || '-'}</span></td>
          <td className="px-2 py-0.5 whitespace-nowrap text-center text-xs leading-tight tabular-nums"><strong>{item.onHandQuantity == null ? '—' : `${item.onHandQuantity.toLocaleString('ko-KR')}개`}</strong> <span className="block text-[10px] leading-tight text-muted-foreground">작업 가능 {Math.max(0, item.reservedQuantity - item.packedQuantity).toLocaleString('ko-KR')}개</span></td>
          <td className="px-2 py-0.5 font-semibold tabular-nums">{item.reservedQuantity.toLocaleString('ko-KR')}개</td><td className="px-2 py-0.5 tabular-nums">{item.packedQuantity.toLocaleString('ko-KR')}개</td>
          <td className="px-2 py-0.5"><span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${complete ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{complete && <Check className="size-3" />}{complete ? '완료' : '미완료'}</span></td>
          <td className="px-2 py-0.5">{allocations.length ? <details><summary className="block cursor-pointer truncate text-[11px]">{allocations.length}박스</summary><div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">{allocations.map((allocation) => <p key={allocation.id}><span data-no-translate>{boxes.find((box) => box.id === allocation.boxId)?.boxNo}</span>번: {allocation.quantity}개</p>)}</div></details> : <span className="text-xs text-muted-foreground">미분할</span>}</td>
          <td className="px-2 py-0.5 text-xs">{receipts.length ? <details><summary className="block cursor-pointer truncate text-[10px]">입고 {receipts.length}박스 · 송장 {new Set(receipts.map((piece) => piece.trackingNumber)).size}개</summary><div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{receipts.map((piece) => <p key={piece.receiptBoxId}><span data-no-translate>{piece.trackingNumber}</span> · 입고 {piece.receivedQuantity}개/박스</p>)}</div></details> : <span className="whitespace-nowrap text-[10px] text-muted-foreground">검수 포장정보 없음</span>}</td>
          <td className="px-2 py-0.5"><button type="button" disabled={isPending} aria-label={`${item.sku} 박스분할 수정`} onClick={() => setEditingId(item.id)} className="h-6 whitespace-nowrap rounded-md border px-1.5 text-xs font-medium hover:bg-muted">{editable ? '박스분할 수정' : '박스분할 보기'}</button></td>
        </tr>
      })}</tbody>
    </table></div>
    {editingItem && <ItemBoxSplitDialog key={editingItem.id} detail={detail} item={editingItem} editable={editable} isPending={isPending} allowDeferredSave onClose={() => setEditingId(null)} />}
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

function stockItemCategory(item: ChinaShipmentStockItem) {
  const category = item.itemCategory?.trim().replace(/^\[(.*)\]$/, '$1').trim()
  if (category === '부재료' || category === '부자재') return '부자재'
  return category || '상품'
}

function StockCategoryFilter({ items, value, onChange, disabled = false }: {
  items: ChinaShipmentStockItem[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const category = stockItemCategory(item)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const categories = [...new Set(['상품', '부자재', ...counts.keys(), ...(value ? [value] : [])])]
  return <div className="mt-3 border-t pt-3">
    <p className="mb-2 text-xs font-medium text-muted-foreground">품목구분</p>
    <div role="group" aria-label="출고 품목구분 선택" className="flex flex-wrap gap-2">
      {['', ...categories].map((category) => <button key={category} type="button" aria-pressed={value === category} disabled={disabled}
        onClick={() => onChange(category)}
        className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium disabled:opacity-60 ${value === category ? 'border-primary bg-primary/5 text-primary' : 'bg-background hover:bg-muted'}`}>
        <span>{category || '전체'}</span><span className="tabular-nums text-muted-foreground">{(category ? counts.get(category) ?? 0 : items.length).toLocaleString('ko-KR')}종</span>
      </button>)}
    </div>
  </div>
}

function ShipmentItemAdditionPanel({ shipmentId, inventoryItems, warehouseCodes, editable, isPending, sampleButton, sampleForm }: {
  shipmentId: string
  inventoryItems: ChinaShipmentStockItem[]
  warehouseCodes: string[]
  editable: boolean
  isPending: boolean
  sampleButton?: ReactNode
  sampleForm?: ReactNode
}) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const [isOpen, setIsOpen] = useState(false)
  const [isAdding, startAdding] = useTransition()
  const [stock, setStock] = useState(inventoryItems)
  const [loadingStock, setLoadingStock] = useState(false)
  const [stockError, setStockError] = useState('')
  const [selectedWarehouseCodes, setSelectedWarehouseCodes] = useState<string[]>([])
  const [stockCategory, setStockCategory] = useState('')
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
  const availableStock = stock.filter((item) => item.availableQuantity > 0)
  const warehouseOptions = [...new Set([...warehouseCodes, ...stock.map((item) => item.warehouseCode)])]
    .sort((left, right) => left.localeCompare(right, 'ko-KR', { numeric: true }))
  const availableQuantityByWarehouse = new Map<string, number>()
  for (const item of availableStock.filter((item) => !stockCategory || stockItemCategory(item) === stockCategory)) {
    availableQuantityByWarehouse.set(item.warehouseCode, (availableQuantityByWarehouse.get(item.warehouseCode) ?? 0) + item.availableQuantity)
  }
  const allWarehouseSelected = warehouseOptions.length > 0 && warehouseOptions.every((code) => selectedWarehouseCodes.includes(code))
  const availableItems = availableStock
    .filter((item) => selectedWarehouseCodes.includes(item.warehouseCode))
    .filter((item) => !stockCategory || stockItemCategory(item) === stockCategory)
    .filter((item) => matchesChinaStockPeriod(item.lastReceivedAt, fromDate, toDate))
    .filter((item) => !searchKeyword || [item.sku, item.productName, item.chineseProductName ?? '', item.optionName ?? '', item.warehouseCode]
      .some((value) => value.toLocaleLowerCase('ko-KR').includes(searchKeyword)))
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
      setSelectedWarehouseCodes([])
      setStockCategory('')
      setSearch('')
      setIsOpen(false)
      toast.success(`출고품목 ${additionalLines.length.toLocaleString('ko-KR')}종 · ${totalQuantity.toLocaleString('ko-KR')}개를 추가했습니다.`)
      router.refresh()
      return true
  }

  useChinaWorkDraft('additional-items', Object.values(quantities).some((value) => value.trim() !== '') ? {
    kind: 'items', label: '추가 출고품목', snapshot: quantities, save: saveAdditionalItems,
    discard: () => { setQuantities({}); setSelectedWarehouseCodes([]); setStockCategory(''); setSearch(''); setIsOpen(false) },
  } : null)

  function addItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startAdding(async () => {
      await guard.runTask(saveAdditionalItems)
    })
  }

  return <section className="rounded-lg border bg-muted/20 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">출고품목 추가<TitleHelp title="출고품목 추가">선정 후에도 품목이나 추가 수량을 같은 중국출고작업에 예약할 수 있습니다.</TitleHelp></h3></div><div className="flex flex-wrap items-center gap-2"><button type="button" disabled={disabled} onClick={() => isOpen ? guard.requestNavigation(() => setIsOpen(false), ['items']) : void openItems()} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"><Plus className="size-3.5" /> {isOpen ? '추가 닫기' : '품목 추가'}</button>{sampleButton}</div></div>{sampleForm}{!editable ? <p className="mt-3 text-xs text-muted-foreground">포장완료 또는 출고완료 상태에서는 출고품목을 추가할 수 없습니다.</p> : null}{isOpen ? <form onSubmit={addItems} className="mt-3 space-y-3 border-t pt-3">
{loadingStock && <p>재고 불러오는 중</p>}{stockError && <p role="alert">{stockError}</p>}
    <section className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">출고 재고 위치</h4>
        <button type="button" disabled={disabled || warehouseOptions.length === 0} onClick={() => setSelectedWarehouseCodes(allWarehouseSelected ? [] : warehouseOptions)} className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60">{allWarehouseSelected ? '전체 해제' : '전체 선택'}</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="출고 재고 위치 선택">
        {warehouseOptions.map((warehouseCode) => <label key={warehouseCode} className={'inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ' + (selectedWarehouseCodes.includes(warehouseCode) ? 'border-primary bg-primary/5 text-primary' : 'bg-background hover:bg-muted')}>
          <input type="checkbox" checked={selectedWarehouseCodes.includes(warehouseCode)} disabled={disabled} className="size-4 accent-primary"
            onChange={() => setSelectedWarehouseCodes((current) => current.includes(warehouseCode) ? current.filter((code) => code !== warehouseCode) : [...current, warehouseCode])} />
          <span>{warehouseCode}</span><span className="text-xs tabular-nums text-muted-foreground">{(availableQuantityByWarehouse.get(warehouseCode) ?? 0).toLocaleString('ko-KR')}개</span>
        </label>)}
        {!loadingStock && warehouseOptions.length === 0 && <p className="text-sm text-muted-foreground">등록된 출고 창고가 없습니다.</p>}
      </div>
      <StockCategoryFilter items={selectedWarehouseCodes.length ? availableStock.filter((item) => selectedWarehouseCodes.includes(item.warehouseCode)) : availableStock} value={stockCategory} onChange={setStockCategory} disabled={disabled} />
    </section>
{selectedWarehouseCodes.length > 0 ? <>
<div className="flex flex-wrap gap-3"><label className="text-xs">최근 입고·재고등록일 시작<input type="date" aria-label="입고일 시작" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={inputClass} /></label><label className="text-xs">최근 입고·재고등록일 종료<input type="date" aria-label="입고일 종료" value={toDate} onChange={(event) => setToDate(event.target.value)} className={inputClass} /></label><button type="button" onClick={() => { setFromDate(''); setToDate('') }} className="self-end rounded border px-3 py-2 text-xs">기간 초기화</button></div>{fromDate && toDate && fromDate > toDate && <p role="alert">조회 시작일과 종료일을 확인해주세요.</p>}
<input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} placeholder="상품명, 상품코드, 옵션, 창고 검색" disabled={disabled} />
<p className="text-xs text-muted-foreground">중국재고의 박스수량으로 박스를 자동 생성하고, 무게·CBM 합계를 박스 수로 나눠 채웁니다. 생성된 박스는 수정할 수 있습니다.</p>
<ChinaShipmentStockTable items={availableItems} quantities={quantities}
  onQuantityChange={(inventoryId, value) => setQuantities((current) => ({ ...current, [inventoryId]: value }))}
  quantityLabel="추가 출고" tableLabel="추가 출고 상품 목록" emptyMessage="조건에 맞는 추가 가능 재고가 없습니다."
  categoryForItem={stockItemCategory} disabled={disabled || guard.busy} />
</> : <p className="rounded-md border border-dashed bg-background px-3 py-8 text-center text-sm text-muted-foreground">출고할 재고 위치를 하나 이상 체크하면 해당 창고의 상품과 작업 가능 수량이 나옵니다.</p>}
<div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p className="text-xs text-muted-foreground">추가 예정: {additionalLines.length.toLocaleString('ko-KR')}개 품목 · {totalQuantity.toLocaleString('ko-KR')}개</p><div className="flex gap-2"><button type="button" disabled={disabled} onClick={() => { setQuantities({}); setSelectedWarehouseCodes([]); setSearch(''); setIsOpen(false) }} className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60">취소</button><button type="submit" disabled={disabled || additionalLines.length === 0} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isAdding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} 선택 품목 추가</button></div></div></form> : null}</section>
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
  const guard = useChinaWorkGuard()
  const acceptSavedState = useContext(BoxSplitSavedContext)
  const draftId = `box:${item.id}`
  const retainedSnapshot = asBoxSplitDraftSnapshot(guard.getDraft(draftId)?.snapshot)
  function allocationDraft(allocation: ChinaShipmentDetailView['boxItems'][number], box: ChinaShipmentDetailView['boxes'][number]): BoxSplitDraft {
    const exclusive = !allBoxItems.some((entry) => entry.boxId === box.id && entry.shipmentItemId !== item.id)
    const measurement = (field: 'lengthCm' | 'widthCm' | 'heightCm' | 'grossWeightKg') => {
      const value = allocation[field] ?? (exclusive ? box[field] : null)
      return value == null ? '' : String(value)
    }
    return { key: allocation.id, boxId: box.id, boxNo: box.boxNo, quantity: String(allocation.quantity),
      lengthCm: measurement('lengthCm'), widthCm: measurement('widthCm'), heightCm: measurement('heightCm'), manualCbm: allocation.manualCbm == null ? exclusive && box.manualCbm != null ? String(box.manualCbm) : '' : String(allocation.manualCbm), grossWeightKg: measurement('grossWeightKg') }
  }
  const [initialDrafts, setInitialDrafts] = useState<BoxSplitDraft[]>(() => cloneBoxSplitDrafts(retainedSnapshot?.baseline ?? (allocations.length > 0
    ? allocations.map(({ allocation, box }) => allocationDraft(allocation, box))
    : [{ ...createBoxSplitDraft(), boxNo: nextAvailableBoxNumbers(1, [...allBoxes.map((box) => box.boxNo), ...guard.getBoxNumbers(draftId)])[0], autoNumber: true }])))
  const [drafts, setDrafts] = useState<BoxSplitDraft[]>(() => cloneBoxSplitDrafts(retainedSnapshot?.drafts ?? initialDrafts))
  const [initialBoxSplitStatus, setInitialBoxSplitStatus] = useState<BoxSplitStatus>(() => retainedSnapshot?.baselineStatus ?? item.boxSplitStatus)
  const [quantityPerBox, setQuantityPerBox] = useState(() => {
    const quantities = drafts.filter((draft) => draft.boxNo.trim()).map((draft) => positiveInteger(draft.quantity) ?? 0)
    const first = quantities[0]
    return first && quantities.reduce((sum, quantity) => sum + quantity, 0) === item.reservedQuantity
      && quantities.every((quantity, index) => quantity > 0 && (index === quantities.length - 1 ? quantity <= first : quantity === first))
      ? String(first) : ''
  })
  const [boxCount, setBoxCount] = useState(() => {
    const count = drafts.filter((draft) => draft.boxNo.trim()).length
    return count ? String(count) : ''
  })
  const firstBox = drafts[0] ? fillChinaOutboundDimensionInputs(drafts[0]) : undefined
  const firstDimensions = firstBox ? [firstBox.lengthCm, firstBox.widthCm, firstBox.heightCm] : []
  const firstManualCbmValid = !!firstBox?.manualCbm.trim() && Number.isFinite(Number(firstBox.manualCbm)) && Number(firstBox.manualCbm) >= 0.000001 && Number(firstBox.manualCbm) <= 999_999_999
  const canApplyFirstBoxDimensions = firstBox && (firstDimensions.every((value) => !value.trim()) || firstDimensions.every((value) => Number.isFinite(Number(value)) && Number(value) > 0))
    && (firstManualCbmValid || firstDimensions.every((value) => Number.isFinite(Number(value)) && Number(value) > 0))
    && (!firstBox.manualCbm.trim() || firstManualCbmValid)
    && (!firstBox.grossWeightKg.trim() || (Number.isFinite(Number(firstBox.grossWeightKg)) && Number(firstBox.grossWeightKg) >= 0.001 && Number(firstBox.grossWeightKg) <= 999_999_999))

  function applyFirstBoxDimensions() {
    if (!canApplyFirstBoxDimensions) return
    setDrafts((current) => current.map((draft) => ({
      ...draft,
      lengthCm: firstBox.lengthCm,
      widthCm: firstBox.widthCm,
      heightCm: firstBox.heightCm,
      manualCbm: firstBox.manualCbm,
      ...(firstBox.grossWeightKg.trim() ? { grossWeightKg: firstBox.grossWeightKg } : {}),
    })))
  }

  function occupiedNumbers() { return [...allBoxes.map((box) => box.boxNo), ...(guard.getBoxNumbers?.(draftId) ?? [])] }
  function generateSplits() {
    try {
      const existingDrafts = drafts.filter((draft) => draft.boxNo.trim())
      const plan = planAutomaticBoxSplit(item.reservedQuantity, quantityPerBox.trim() ? { quantityPerBox: Number(quantityPerBox), ...(boxCount.trim() ? { boxCount: Number(boxCount) } : {}) } : { boxCount: Number(boxCount) }, occupiedNumbers(), existingDrafts.map((draft) => draft.boxNo))
      setDrafts(plan.map((entry, index) => ({
        ...(existingDrafts[index] ?? { ...createBoxSplitDraft(), lengthCm: firstBox?.lengthCm ?? '', widthCm: firstBox?.widthCm ?? '', heightCm: firstBox?.heightCm ?? '', manualCbm: firstBox?.manualCbm ?? '', autoNumber: true }),
        boxNo: entry.boxNo,
        quantity: String(entry.quantity),
      })))
    } catch (error) { toast.error(error instanceof Error ? error.message : '박스분할 값을 확인해주세요.') }
  }
  const splitQuantity = drafts.reduce((total, draft) => total + (positiveInteger(draft.quantity) ?? 0), 0)
  // Keep the legacy stored status consistent with quantities without a manual selector.
  const currentBoxSplitStatus: BoxSplitStatus = splitQuantity === item.reservedQuantity ? 'completed' : 'in_progress'

  function patchDraft(key: string, patch: Partial<BoxSplitDraft>) {
    setDrafts((current) => current.map((draft) => {
      if (draft.key !== key) return draft
      if (patch.boxNo === undefined) return { ...draft, ...patch }
      // Measurements belong to this product allocation, including when it moves into a mixed box.
      return { ...draft, ...patch, autoNumber: false }
    }))
  }

  async function saveDraft(options: { quiet?: boolean } = {}) {
    if (drafts.some((draft) => draft.manualCbm.trim() && (!Number.isFinite(Number(draft.manualCbm)) || Number(draft.manualCbm) < 0.000001 || Number(draft.manualCbm) > 999_999_999))) {
      toast.error('CBM은 0.000001 이상, 999,999,999 이하로 입력해주세요.')
      return false
    }
    const preparedDrafts = drafts.map(fillChinaOutboundDimensionInputs)
    const nextAllocations = preparedDrafts
      .filter((draft) => [draft.boxNo, draft.quantity, draft.lengthCm, draft.widthCm, draft.heightCm, draft.manualCbm, draft.grossWeightKg].some((value) => value.trim()))
      .map((draft) => {
        const previous = initialDrafts.find((candidate) => candidate.key === draft.key)
        const moved = draft.boxNo.trim() !== previous?.boxNo.trim()
        const dimensionsChanged = moved || !previous || [draft.lengthCm, draft.widthCm, draft.heightCm].some((value, index) => value !== [previous.lengthCm, previous.widthCm, previous.heightCm][index])
        return {
          boxNo: draft.boxNo.trim(),
          ...(draft.autoNumber ? { autoNumber: true } : {}),
          ...(draft.boxId && draft.boxNo.trim() !== initialDrafts.find((entry) => entry.boxId === draft.boxId)?.boxNo
            && !allBoxes.some((box) => box.id !== draft.boxId && box.boxNo === draft.boxNo.trim())
            && !allBoxItems.some((entry) => entry.boxId === draft.boxId && entry.shipmentItemId !== item.id)
            ? { existingBoxId: draft.boxId } : {}),
          quantity: Number(draft.quantity),
          // Unchanged measurements preserve any manual physical-box override.
          lengthCm: dimensionsChanged ? optionalNumber(draft.lengthCm) : null,
          widthCm: dimensionsChanged ? optionalNumber(draft.widthCm) : null,
          heightCm: dimensionsChanged ? optionalNumber(draft.heightCm) : null,
          ...(draft.manualCbm !== (previous?.manualCbm ?? '') || (moved && draft.manualCbm.trim()) ? { manualCbm: optionalNumber(draft.manualCbm) } : {}),
          ...(moved || draft.grossWeightKg !== (previous?.grossWeightKg ?? '') ? { grossWeightKg: optionalNumber(draft.grossWeightKg) } : {}),
        }
      })
    setDrafts(preparedDrafts)
    const hasBoxSplitStatusChange = currentBoxSplitStatus !== initialBoxSplitStatus
    const result = await saveChinaOutboundItemBoxSplitsAction({
      shipmentId,
      shipmentItemId: item.id,
      allocations: nextAllocations,
      returnSavedState: true,
      ...(hasBoxSplitStatusChange ? { boxSplitStatus: currentBoxSplitStatus } : {}),
    })
    if (!result.ok) {
      toast.error(result.error ?? '박스분할을 저장하지 못했습니다.')
      return false
    }
    if (result.savedState) acceptSavedState(result.savedState)
    const savedBoxes = new Map(result.savedState?.boxes.map((box) => [box.id, box]) ?? [])
    const persistedDrafts = result.savedState ? result.savedState.boxItems.flatMap((allocation) => {
      const box = savedBoxes.get(allocation.boxId)
      return box && allocation.shipmentItemId === item.id ? [allocationDraft(allocation, box)] : []
    }) : preparedDrafts
    setDrafts(cloneBoxSplitDrafts(persistedDrafts))
    setInitialDrafts(cloneBoxSplitDrafts(persistedDrafts))
    setInitialBoxSplitStatus(currentBoxSplitStatus)
    guard.setDraft(draftId, null)
    if (!options.quiet) toast.success(`${item.productName}의 박스분할을 저장했습니다.`)
    // The persisted rows update this shipment directly, without a full page reload.
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
    }, save: saveDraft, saveQuietly: () => saveDraft({ quiet: true }),
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
            <TitleHelp title="박스분할">CBM은 직접 입력하거나 규격으로 자동 계산할 수 있습니다. 한 박스에 여러 품목을 담으려면 같은 박스번호를 입력하세요.</TitleHelp><ProgressBadge completed={currentBoxSplitStatus === 'completed'} detail={`${item.packedQuantity.toLocaleString('ko-KR')} / ${item.reservedQuantity.toLocaleString('ko-KR')}개`} />
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
        {drafts.length > 1 && <button type="button"
          disabled={!editable || isPending || guard.busy || !canApplyFirstBoxDimensions}
          onClick={applyFirstBoxDimensions}
          className="h-8 rounded-md border bg-background px-3 text-xs font-medium disabled:opacity-50">
          첫 박스 규격·무게 전체 적용
        </button>}
      </div>
      <p className="border-b px-3 py-2 text-xs text-muted-foreground">혼합박스는 품목별 중량을 합산하고 가장 큰 부피의 규격을 적용합니다. 품목별 중량을 모두 입력해주세요. 박스 전체 실측값은 2단계에서 수정할 수 있습니다.</p>
      <p className="border-b px-3 py-2 text-xs text-muted-foreground">CBM을 직접 입력하면 빈 치수는 같은 부피의 추정 치수로 채웁니다. 입력한 치수는 유지하며, CBM을 비우면 규격으로 자동 계산합니다.</p>
      <div className="overflow-x-auto">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="bg-muted/10 text-xs text-muted-foreground">
            <tr>
              <th className="w-[18%] px-3 py-2 text-left font-medium">박스번호</th>
              <th className="w-[12%] px-3 py-2 text-right font-medium">적재수량</th>
              <th className="w-[12%] px-3 py-2 text-right font-medium">가로(cm)</th>
              <th className="w-[12%] px-3 py-2 text-right font-medium">세로(cm)</th>
              <th className="w-[12%] px-3 py-2 text-right font-medium">높이(cm)</th>
              <th className="w-[14%] px-3 py-2 text-right font-medium">총중량(kg)</th>
              <th className="w-[12%] px-3 py-2 text-right font-medium">CBM</th>
              <th className="w-[8%] px-3 py-2 text-center font-medium">관리</th>
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
                  <td className="px-3 py-2">
                    <input
                      aria-label={`박스 ${draft.boxNo} 총중량(kg)`}
                      type="number"
                      min="0.001"
                      max="999999999"
                      step="0.001"
                      value={draft.grossWeightKg}
                      onChange={(event) => patchDraft(draft.key, { grossWeightKg: event.target.value })}
                      disabled={!editable || isPending}
                      className={`${compactInputClass} text-right tabular-nums`}
                      placeholder="미입력"
                    />
                  </td>
                  <td className="px-3 py-2"><input aria-label={`박스 ${draft.boxNo} CBM(직접 입력)`} type="number" min="0.000001" max="999999999" step="0.000001" value={draft.manualCbm} onChange={(event) => patchDraft(draft.key, { manualCbm: event.target.value })} onBlur={() => { const filled = fillChinaOutboundDimensionInputs(draft); patchDraft(draft.key, { lengthCm: filled.lengthCm, widthCm: filled.widthCm, heightCm: filled.heightCm }) }} disabled={!editable || isPending} className={`${compactInputClass} text-right tabular-nums`} placeholder={formatChinaOutboundCbm(cbm) ?? '직접 입력'} /></td>
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
  const canEditBox = (box: ChinaShipmentDetailView['boxes'][number]) => editable && box.editable && box.status !== 'sealed'
  const changedBoxes = sortedBoxes.filter((box) => canEditBox(box) && (palletNumbers[box.boxNo] ?? '').trim() !== (initialNumbers[box.boxNo] ?? '').trim())
  const changedBoxIds = new Set(changedBoxes.map((box) => box.id))
  const selectableBoxNos = new Set(sortedBoxes.filter((box) => canEditBox(box) && !(initialNumbers[box.boxNo] ?? '').trim()).map((box) => box.boxNo))
  const selected = new Set(selectedBoxNos.filter((boxNo) => selectableBoxNos.has(boxNo)))
  const allSelected = selectableBoxNos.size > 0 && [...selectableBoxNos].every((boxNo) => selected.has(boxNo))

  function selectBox(boxNo: string, checked: boolean) {
    if (!selectableBoxNos.has(boxNo)) return
    setSelectedBoxNos((current) => checked ? [...new Set([...current, boxNo])] : current.filter((candidate) => candidate !== boxNo))
  }

  function selectAll(checked: boolean) {
    const visible = selectableBoxNos
    setSelectedBoxNos((current) => checked ? [...new Set([...current, ...visible])] : current.filter((boxNo) => !visible.has(boxNo)))
  }

  async function saveDraft(boxNos?: string[], quiet = false) {
    const requested = boxNos ? new Set(boxNos) : null
    const boxesToSave = sortedBoxes.filter((box) => canEditBox(box) && (requested ? requested.has(box.boxNo) : changedBoxIds.has(box.id) || (!quiet && !(initialNumbers[box.boxNo] ?? '').trim())))
    if (!boxesToSave.length) {
      if (!quiet) toast.error(requested ? '선택한 박스 중 저장할 파렛트 배정 변경사항이 없습니다.' : '저장할 파렛트 배정 변경사항이 없습니다.')
      return quiet
    }
    const assignments = boxesToSave.map((box) => ({ boxNo: box.boxNo, palletNo: normalizeChinaPalletNumber(palletNumbers[box.boxNo]) }))
    const result = await assignChinaOutboundBoxesToPalletsAction({ shipmentId, assignments })
    if (!result.ok) { toast.error(result.error ?? '파렛트 적재를 저장하지 못했습니다.'); return false }
    const savedNumbers = Object.fromEntries(assignments.map((assignment) => [assignment.boxNo, assignment.palletNo ?? '']))
    setInitialNumbers((current) => ({ ...current, ...savedNumbers }))
    setPalletNumbers((current) => ({ ...current, ...savedNumbers }))
    const clearedBoxNos = requested ?? new Set(sortedBoxes.map((box) => box.boxNo))
    setSelectedBoxNos((current) => current.filter((boxNo) => !clearedBoxNos.has(boxNo)))
    if (changedBoxes.every((box) => boxesToSave.some((saved) => saved.id === box.id))) guard.setDraft('pallet-assignments', null)
    if (!quiet) toast.success(`${boxesToSave.length.toLocaleString('ko-KR')}개 박스의 파렛트 배정을 저장했습니다.`)
    router.refresh()
    return true
  }

  useChinaWorkDraft('pallet-assignments', changedBoxes.length > 0 ? {
    kind: 'pallet', label: '파렛트 적재', snapshot: palletNumbers, save: () => saveDraft(undefined, true),
    discard: () => setPalletNumbers({ ...initialNumbers }),
  } : null)

  return <section className="overflow-hidden rounded-lg border">
    <p className="border-b px-4 py-2 text-xs text-muted-foreground">파렛트는 숫자로 입력하세요. 공란이나 문자는 박스로 저장됩니다.</p>
    <div className="overflow-x-auto"><table className="min-w-[1350px] w-full table-fixed border-collapse text-sm"><colgroup>{[36, 64, 106, 220, 130, 80, 220, 90, 100, 110].map((width, index) => <col key={index} style={{ width }} />)}</colgroup><thead className="bg-muted/30 text-xs"><tr><th className="whitespace-nowrap px-2 py-1.5 text-center font-medium"><input type="checkbox" aria-label="표시된 파렛트 배정 전체 선택" checked={allSelected} onChange={(event) => selectAll(event.target.checked)} disabled={!editable || isPending || guard.busy || !selectableBoxNos.size} className="size-3.5 accent-primary" /></th><th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">박스번호</th>{['품목코드', '상품명', '옵션', '수량'].map((label) => <th key={label} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{label}</th>)}<th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">규격 가로×세로×높이(cm)</th><th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">CBM</th><th className="whitespace-nowrap px-2 py-1.5 text-center font-medium">파렛트번호</th><th className="whitespace-nowrap px-2 py-1.5 text-center font-medium">관리</th></tr></thead><tbody>{sortedBoxes.map((box) => {
      const boxItems = boxItemsByBox.get(box.id) ?? []
      const products = boxItems.flatMap((boxItem) => {
        const item = itemById.get(boxItem.shipmentItemId)
        return item ? [{ id: boxItem.id, sku: item.sku, name: item.productName, option: item.optionName, identity: `${item.sku} ${item.productName}${item.optionName ? ` · ${item.optionName}` : ''}${item.chineseProductName ? ` / ${item.chineseProductName}` : ''}`, quantity: boxItem.quantity }] : []
      })
      const cbm = calculateChinaOutboundBoxCbm(box)
      const changed = changedBoxIds.has(box.id)
      return <tr key={box.id} className={`border-t align-middle [&>td]:[&>td:last-child]:border-r-0 ${changed ? 'bg-blue-50/60' : ''}`}><td className="px-2 py-1 text-center"><input type="checkbox" aria-label={`박스 ${box.boxNo} 파렛트 배정 선택`} checked={selected.has(box.boxNo)} onChange={(event) => selectBox(box.boxNo, event.target.checked)} disabled={!editable || isPending || guard.busy || !selectableBoxNos.has(box.boxNo)} className="size-3.5 accent-primary" /></td><td className="px-2 py-1 font-medium">{box.boxNo}</td>{(['sku', 'name', 'option', 'quantity'] as const).map((column) => <td key={column} className="overflow-hidden px-2 py-1 text-xs">
        {products.map((product) => <div key={product.id} className="h-6 truncate leading-6" data-no-translate title={column === 'name' ? product.name : column === 'option' ? product.option ?? '' : undefined}>
          {column === 'sku' ? <ItemCodeCell code={product.sku} /> : column === 'quantity' ? `${product.quantity.toLocaleString('ko-KR')}개` : product[column] || '—'}
        </div>)}
      </td>)}<td className="px-2 py-1 text-right text-xs">{formatChinaOutboundBoxDimensions(box) ?? '미입력'}</td><td className="px-2 py-1 text-right tabular-nums">{formatChinaOutboundCbm(cbm) ?? '-'}</td><td className="whitespace-nowrap px-2 py-1.5 text-center"><input aria-label={`박스 ${box.boxNo} 파렛트 번호`} value={palletNumbers[box.boxNo] ?? ''} onChange={(event) => setPalletNumbers((current) => ({ ...current, [box.boxNo]: event.target.value }))} disabled={!canEditBox(box) || isPending || guard.busy} className={`${compactInputClass} mx-auto block max-w-24 text-center enabled:border-blue-200 enabled:bg-blue-50 focus:border-blue-500 disabled:border-transparent disabled:bg-muted/30 disabled:text-muted-foreground`} placeholder="박스" title="숫자만 파렛트 번호로 저장합니다. 공란·문자는 박스로 저장합니다." /></td><td className="whitespace-nowrap px-2 py-1.5 text-center"><button type="button" aria-label={`박스 ${box.boxNo} 파렛트 수정`} disabled={!canEditBox(box) || isPending || guard.busy || !changed} onClick={() => void guard.runTask(() => saveDraft([box.boxNo]))} className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-900 hover:bg-blue-100 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"><Check className="size-3.5" />저장하기</button></td></tr>
    })}</tbody></table></div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-4 py-3"><div className="flex flex-wrap items-center gap-2"><span className="text-xs">선택 {selected.size.toLocaleString('ko-KR')}개</span><button type="button" aria-label="파렛트 배정 선택 저장" disabled={!editable || isPending || guard.busy || !selected.size} onClick={() => void guard.runTask(() => saveDraft([...selected]))} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"><Check className="size-3.5" /> 선택한 박스 배정 저장</button><button type="button" aria-label="파렛트 배정 전체 저장" disabled={!editable || isPending || guard.busy} onClick={() => void guard.runTask(() => saveDraft())} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"><Check className="size-3.5" /> 파렛트 배정 저장</button></div></div>
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
  const [editorOpen, setEditorOpen] = useState(false)

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
        setEditorOpen(false)
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
      <div role="group" aria-label="엑셀 작업" className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
        <span className="mr-1 text-xs font-semibold text-emerald-800">엑셀 작업</span>
        <a
          href={'/api/purchasing/china-shipments/' + encodeURIComponent(shipmentId) + '/workbook'}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-100 px-3 text-sm font-medium text-emerald-950 transition-colors hover:bg-emerald-200"
        >
          <Download className="size-4" />
          작업용 엑셀
        </a>
        {editable && <button type="button" onClick={() => setEditorOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
          <Upload className="size-4" />엑셀로 수정
          {selectedFile && <span aria-hidden="true" className="size-2 rounded-full bg-amber-300" />}
        </button>}
      </div>
      <Dialog.Root open={editorOpen} onOpenChange={(open) => { if (!isWorking) setEditorOpen(open) }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-5 text-foreground shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b pb-3">
              <Dialog.Title className="flex items-center gap-2 text-lg font-semibold"><FileSpreadsheet className="size-5 text-emerald-700" />작업용 엑셀 수정</Dialog.Title>
              <Dialog.Close disabled={isWorking} aria-label="닫기" className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"><X className="size-4" /></Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">수정한 작업용 엑셀을 검토한 뒤 반영합니다.</Dialog.Description>
            <div className="flex flex-wrap items-center gap-2">
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
              <button type="button" disabled={!editable || isWorking || !selectedFile} onClick={() => void guard.runTask(() => uploadWorkbook('preview'))} className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
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
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
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
  return { key: `box-${Date.now()}-${Math.random()}`, boxNo: '', quantity: '', lengthCm: '', widthCm: '', heightCm: '', manualCbm: '', grossWeightKg: '' }
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
  return drafts.map((draft) => ({ ...draft, manualCbm: draft.manualCbm ?? '', grossWeightKg: draft.grossWeightKg ?? '' }))
}

function boxDraftValues(drafts: BoxSplitDraft[]) {
  return JSON.stringify(drafts.map(({ boxNo, quantity, lengthCm, widthCm, heightCm, manualCbm, grossWeightKg }) => ({ boxNo, quantity, lengthCm, widthCm, heightCm, manualCbm, grossWeightKg })))
}

function optionalNumber(value: string) {
  const normalized = value.trim()
  return normalized ? Number(normalized) : null
}

function positiveInteger(value: string) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function compareShipmentItemWorkProgress(
  left: Pick<ChinaShipmentDetailView['items'][number], 'sku' | 'productName' | 'packedQuantity' | 'reservedQuantity'>,
  right: Pick<ChinaShipmentDetailView['items'][number], 'sku' | 'productName' | 'packedQuantity' | 'reservedQuantity'>,
) {
  const leftComplete = left.packedQuantity === left.reservedQuantity
  const rightComplete = right.packedQuantity === right.reservedQuantity
  if (leftComplete !== rightComplete) return leftComplete ? 1 : -1
  return compareShipmentItems(left, right)
}

function compareShipmentItems(
  left: Pick<ChinaShipmentDetailView['items'][number], 'sku' | 'productName'>,
  right: Pick<ChinaShipmentDetailView['items'][number], 'sku' | 'productName'>,
) {
  return left.sku.localeCompare(right.sku, 'ko-KR', { numeric: true })
    || left.productName.localeCompare(right.productName, 'ko-KR')
}
