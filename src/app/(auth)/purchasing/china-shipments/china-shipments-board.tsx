'use client'

import { type FormEvent, type ReactNode, type TransitionStartFunction, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Check, Container, Loader2, PackagePlus, Plus, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  addChinaOutboundBoxItemAction,
  cancelChinaOutboundShipmentAction,
  configureChinaOutboundPackagingAction,
  createChinaOutboundShipmentAction,
  dispatchChinaOutboundShipmentAction,
  markChinaOutboundShipmentReadyAction,
  removeChinaOutboundBoxItemAction,
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
  status: string
  originWarehouseCode: string
  destinationName: string | null
  plannedOutboundDate: string | null
  createdAt: string
  itemCount: number
  reservedQuantity: number
  packedQuantity: number
}

export type ChinaShipmentStage = 'setup' | 'packing'

export type ChinaShipmentDetailView = {
  shipment: {
    id: string
    shipmentNo: string
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
    warehouseCode: string
    sku: string
    productName: string
    optionName: string | null
    reservedQuantity: number
    packedQuantity: number
    dispatchedQuantity: number
  }>
  pallets: Array<{ id: string; palletNo: string; note: string | null }>
  boxes: Array<{ id: string; palletId: string | null; boxNo: string; status: string; note: string | null }>
  boxItems: Array<{ id: string; boxId: string; shipmentItemId: string; quantity: number }>
}

type InventorySummary = { onHandQuantity: number; reservedQuantity: number; availableQuantity: number }
type PackingDraft = { boxId: string; quantity: string }

const editableStatuses = new Set(['draft', 'packing'])
const statusLabels: Record<string, string> = {
  draft: '초안', packing: '포장중', ready: '포장완료', dispatched: '출고완료', cancelled: '취소',
}

export function ChinaShipmentsBoard({
  inventoryItems,
  inventorySummary,
  shipments,
  selectedShipment,
  selectedStep,
}: {
  inventoryItems: ChinaShipmentStockItem[]
  inventorySummary: InventorySummary
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView | null
  selectedStep: ChinaShipmentStage
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showCreate, setShowCreate] = useState(shipments.length === 0)
  const [stockSearch, setStockSearch] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [shipmentNo, setShipmentNo] = useState('')
  const [destinationName, setDestinationName] = useState('')
  const [plannedOutboundDate, setPlannedOutboundDate] = useState(today())
  const [memo, setMemo] = useState('')

  const availableInventory = inventoryItems.filter((item) => item.availableQuantity > 0)
  const shownInventory = useMemo(() => {
    const keyword = stockSearch.trim().toLocaleLowerCase('ko-KR')
    if (!keyword) return availableInventory
    return availableInventory.filter((item) => [item.sku, item.productName, item.optionName ?? ''].some((value) => value.toLocaleLowerCase('ko-KR').includes(keyword)))
  }, [availableInventory, stockSearch])
  const stagedShipmentLines = availableInventory.flatMap((item) => {
    const quantity = Number(quantities[item.id] ?? 0)
    return Number.isInteger(quantity) && quantity > 0 ? [{ inventoryId: item.id, quantity }] : []
  })
  const stagedOutboundQuantity = stagedShipmentLines.reduce((total, line) => total + line.quantity, 0)

  function fillAllOutboundQuantities() {
    setQuantities((current) => ({ ...current, ...Object.fromEntries(shownInventory.map((item) => [item.id, String(item.availableQuantity)])) }))
  }

  function createShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await createChinaOutboundShipmentAction({
        shipmentNo,
        destinationName,
        plannedOutboundDate: plannedOutboundDate || null,
        memo,
        lines: stagedShipmentLines,
      })
      if (!result.ok) return toast.error(result.error)
      if (!result.shipmentId) return toast.error('출고작업을 열지 못했습니다. 다시 시도해주세요.')
      toast.success('중국출고 작업을 만들고 재고를 예약했습니다.')
      setShowCreate(false)
      setQuantities({})
      setShipmentNo('')
      setDestinationName('')
      setMemo('')
      router.push(shipmentHref(result.shipmentId, 'setup'))
      router.refresh()
    })
  }

  return (
    <div className="space-y-4" aria-busy={isPending}>
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="SaaS 현재고" value={inventorySummary.onHandQuantity} />
        <SummaryCard label="출고 예약" value={inventorySummary.reservedQuantity} tone="amber" />
        <SummaryCard label="새 작업 가능" value={inventorySummary.availableQuantity} tone="emerald" />
      </section>

      <section className="rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold">새 중국출고 작업</h2><p className="mt-1 text-xs text-muted-foreground">상품과 출고수량을 예약한 뒤, 다음 단계에서 박스·파렛트 구성과 포장을 진행합니다.</p></div>
          <button type="button" onClick={() => setShowCreate((open) => !open)} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"><PackagePlus className="size-4" />{showCreate ? '작업 생성 닫기' : '새 출고작업'}</button>
        </div>
        {showCreate ? <form onSubmit={createShipment} className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="쉽먼트 번호"><input value={shipmentNo} onChange={(event) => setShipmentNo(event.target.value)} className={inputClass} placeholder="비우면 자동 생성" /></Field>
            <Field label="도착지"><input value={destinationName} onChange={(event) => setDestinationName(event.target.value)} className={inputClass} placeholder="예: 한국 1창고" /></Field>
            <Field label="출고예정일"><input type="date" value={plannedOutboundDate} onChange={(event) => setPlannedOutboundDate(event.target.value)} className={inputClass} /></Field>
          </div>
          <Field label="메모"><input value={memo} onChange={(event) => setMemo(event.target.value)} className={inputClass} placeholder="포워더, 출고 목적 등" /></Field>
          <section className="rounded-md border bg-muted/20 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">출고할 상품과 수량</h3><p className="mt-1 text-xs text-muted-foreground">창고별 현재고를 나누어 보이지 않고, 상품별 작업 가능 수량만 보여줍니다.</p></div><button type="button" onClick={fillAllOutboundQuantities} className="h-8 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted">보이는 상품 전체수량</button></div>
            <input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} className="mt-3 h-9 w-full rounded-md border bg-background px-3 text-sm sm:max-w-sm" placeholder="상품명, 상품코드, 옵션 검색" />
            {stagedShipmentLines.length > 0 ? <p className="mt-3 text-xs font-medium text-primary">선택됨: {stagedShipmentLines.length.toLocaleString('ko-KR')}개 품목 · 전체 {stagedOutboundQuantity.toLocaleString('ko-KR')}개</p> : null}
            <div className="mt-3 max-h-[440px] space-y-2 overflow-y-auto pr-1">
              {shownInventory.length === 0 ? <p className="rounded-md border bg-background px-3 py-8 text-center text-sm text-muted-foreground">조건에 맞는 작업 가능 재고가 없습니다.</p> : shownInventory.map((item) => <article key={item.id} className="rounded-md border bg-background p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-medium">{item.productName}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</p></div><div className="flex items-end gap-3"><div className="text-right text-xs text-muted-foreground"><p>현재고 {item.onHandQuantity.toLocaleString('ko-KR')}개</p><p className="mt-1 font-medium text-emerald-700">작업 가능 {item.availableQuantity.toLocaleString('ko-KR')}개</p></div><label className="block"><span className="mb-1 block text-xs text-muted-foreground">이번 출고</span><input type="number" min="0" max={item.availableQuantity} step="1" value={quantities[item.id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="h-9 w-24 rounded-md border px-2 text-right text-sm tabular-nums" placeholder="0" /></label></div></div></article>)}
            </div>
          </section>
          <div className="flex justify-end"><button type="submit" disabled={isPending || stagedShipmentLines.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 출고작업 만들기</button></div>
        </form> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
        <ShipmentList shipments={shipments} selectedShipmentId={selectedShipment?.shipment.id} onSelect={(id) => router.push(shipmentHref(id, 'setup'))} />
        <ShipmentDetailPanel key={selectedShipment?.shipment.id ?? 'no-shipment'} detail={selectedShipment} stage={selectedStep} isPending={isPending} startTransition={startTransition} router={router} onStageChange={(stage) => selectedShipment && router.push(shipmentHref(selectedShipment.shipment.id, stage))} />
      </div>
    </div>
  )
}

function ShipmentList({ shipments, selectedShipmentId, onSelect }: { shipments: ChinaShipmentListItem[]; selectedShipmentId?: string; onSelect: (id: string) => void }) {
  return <section className="overflow-hidden rounded-lg border bg-card"><div className="border-b px-4 py-3"><h2 className="font-semibold">출고작업 목록</h2><p className="mt-1 text-xs text-muted-foreground">총 {shipments.length.toLocaleString('ko-KR')}건</p></div><div className="max-h-[720px] overflow-y-auto p-2">{shipments.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">아직 만든 출고작업이 없습니다.</p> : shipments.map((shipment) => { const selected = shipment.id === selectedShipmentId; return <button key={shipment.id} type="button" onClick={() => onSelect(shipment.id)} className={`mb-1 w-full rounded-md border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted'}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{shipment.shipmentNo}</span><StatusBadge status={shipment.status} /></div><p className="mt-1 truncate text-xs text-muted-foreground">도착지: {shipment.destinationName || '미입력'}</p><p className="mt-1 text-xs text-muted-foreground">출고예정일: {shipment.plannedOutboundDate || '미입력'} · 등록일: {formatRegisteredDate(shipment.createdAt)}</p><p className="mt-2 text-xs tabular-nums text-muted-foreground">상품 {shipment.itemCount.toLocaleString('ko-KR')}종 · 전체 {shipment.reservedQuantity.toLocaleString('ko-KR')}개 · 포장 {shipment.packedQuantity.toLocaleString('ko-KR')}개</p></button> })}</div></section>
}

function ShipmentDetailPanel({ detail, stage, isPending, startTransition, router, onStageChange }: { detail: ChinaShipmentDetailView | null; stage: ChinaShipmentStage; isPending: boolean; startTransition: TransitionStartFunction; router: ReturnType<typeof useRouter>; onStageChange: (stage: ChinaShipmentStage) => void }) {
  const [palletCount, setPalletCount] = useState(() => String(detail?.pallets.length || 1))
  const [boxCount, setBoxCount] = useState(() => String(detail?.boxes.length || 1))
  const [packingDrafts, setPackingDrafts] = useState<Record<string, PackingDraft>>({})

  if (!detail) return <section className="flex min-h-[360px] items-center justify-center rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">왼쪽에서 출고작업을 선택하면 박스·파렛트 구성과 상품 포장을 단계별로 처리할 수 있습니다.</section>

  const { shipment, items, pallets, boxes, boxItems } = detail
  const editable = editableStatuses.has(shipment.status)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const boxById = new Map(boxes.map((box) => [box.id, box]))
  const palletById = new Map(pallets.map((pallet) => [pallet.id, pallet]))
  const boxesByPallet = new Map(pallets.map((pallet) => [pallet.id, boxes.filter((box) => box.palletId === pallet.id)]))
  const boxItemsByBox = new Map(boxes.map((box) => [box.id, boxItems.filter((item) => item.boxId === box.id)]))
  const openBoxes = boxes.filter((box) => box.status === 'open')
  const firstOpenBoxId = openBoxes[0]?.id ?? ''
  const totalOutboundQuantity = items.reduce((total, item) => total + item.reservedQuantity, 0)
  const totalPackedQuantity = items.reduce((total, item) => total + item.packedQuantity, 0)
  const hasPackaging = pallets.length > 0 && boxes.length > 0

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string, afterSuccess?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) return toast.error(result.error ?? '처리하지 못했습니다.')
      afterSuccess?.()
      toast.success(successMessage)
      router.refresh()
    })
  }

  function savePackagingSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    run(() => configureChinaOutboundPackagingAction({ shipmentId: shipment.id, palletCount: Number(palletCount), boxCount: Number(boxCount) }), '박스·파렛트 구성을 저장했습니다. 이제 상품별로 박스를 배정하세요.', () => onStageChange('packing'))
  }

  function setPackingDraft(itemId: string, patch: Partial<PackingDraft>) {
    setPackingDrafts((current) => ({ ...current, [itemId]: { boxId: current[itemId]?.boxId || firstOpenBoxId, quantity: current[itemId]?.quantity ?? '', ...patch } }))
  }

  function addPacking(event: FormEvent<HTMLFormElement>, item: ChinaShipmentDetailView['items'][number]) {
    event.preventDefault()
    const draft = packingDrafts[item.id]
    run(() => addChinaOutboundBoxItemAction({ shipmentId: shipment.id, boxId: draft?.boxId || firstOpenBoxId, shipmentItemId: item.id, quantity: Number(draft?.quantity) }), `${item.productName}을(를) 박스에 배정했습니다.`, () => setPackingDrafts((current) => ({ ...current, [item.id]: { boxId: draft?.boxId || firstOpenBoxId, quantity: '' } })))
  }

  return <section className="space-y-4 rounded-lg border bg-card p-4">
    <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-start md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{shipment.shipmentNo}</h2><StatusBadge status={shipment.status} /></div><p className="mt-1 text-sm text-muted-foreground">도착지: {shipment.destinationName || '미입력'} · 출고예정일: {shipment.plannedOutboundDate || '미입력'}</p><p className="mt-1 text-xs text-muted-foreground">상품 {items.length.toLocaleString('ko-KR')}종 · 전체 출고 {totalOutboundQuantity.toLocaleString('ko-KR')}개 · 포장 {totalPackedQuantity.toLocaleString('ko-KR')}개</p>{shipment.memo ? <p className="mt-1 text-xs text-muted-foreground">메모: {shipment.memo}</p> : null}</div><div className="flex flex-wrap gap-2">{editable && stage === 'packing' ? <button type="button" disabled={isPending} onClick={() => run(() => markChinaOutboundShipmentReadyAction({ shipmentId: shipment.id }), '포장완료로 전환했습니다.')} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"><Check className="size-4" /> 포장완료</button> : null}{shipment.status === 'ready' ? <button type="button" disabled={isPending} onClick={() => { if (window.confirm('포장된 수량을 SaaS 중국재고에서 차감하고 출고완료 처리할까요?')) run(() => dispatchChinaOutboundShipmentAction({ shipmentId: shipment.id }), '출고완료 처리했습니다. SaaS 재고가 차감되었습니다.') }} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"><Send className="size-4" /> 출고완료</button> : null}{shipment.status !== 'dispatched' && shipment.status !== 'cancelled' ? <button type="button" disabled={isPending} onClick={() => { if (window.confirm('이 출고작업을 취소하고 예약 수량을 풀까요?')) run(() => cancelChinaOutboundShipmentAction({ shipmentId: shipment.id }), '출고작업을 취소하고 재고 예약을 풀었습니다.') }} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"><Trash2 className="size-4" /> 작업 취소</button> : null}</div></div>

    <nav className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-2" aria-label="중국출고 입력 단계"><StageButton active={stage === 'setup'} step="1단계" title="박스 · 파렛트 구성" detail={`파렛트 ${pallets.length}개 · 박스 ${boxes.length}개`} onClick={() => onStageChange('setup')} /><StageButton active={stage === 'packing'} step="2단계" title="상품별 박스 배정" detail={`${totalPackedQuantity.toLocaleString('ko-KR')} / ${totalOutboundQuantity.toLocaleString('ko-KR')}개 포장`} onClick={() => onStageChange('packing')} /></nav>

    {stage === 'setup' ? <section className="space-y-4"><div className="rounded-lg border bg-muted/20 p-4"><h3 className="font-semibold">1단계 · 박스와 파렛트 수를 한 번에 구성</h3><p className="mt-1 text-sm text-muted-foreground">저장하면 `파렛트 1`, `박스 1`처럼 번호가 자동 생성되고 박스는 파렛트 순서대로 나누어 배정됩니다.</p><form onSubmit={savePackagingSetup} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"><Field label="파렛트 수"><input type="number" min="1" max="500" step="1" value={palletCount} onChange={(event) => setPalletCount(event.target.value)} required className={inputClass} /></Field><Field label="박스 수"><input type="number" min="1" max="5000" step="1" value={boxCount} onChange={(event) => setBoxCount(event.target.value)} required className={inputClass} /></Field><button type="submit" disabled={!editable || isPending} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Container className="size-4" />} 구성 저장 후 다음</button></form>{!editable ? <p className="mt-3 text-xs text-muted-foreground">포장완료·출고완료·취소된 작업은 구성 변경 없이 조회만 할 수 있습니다.</p> : null}{pallets.length > 0 || boxes.length > 0 ? <p className="mt-3 text-xs text-muted-foreground">이미 생성된 수량보다 작게 줄일 수는 없습니다. 추가가 필요하면 현재 수량 이상으로 입력하세요.</p> : null}</div><PackagingSetupOverview pallets={pallets} boxesByPallet={boxesByPallet} /></section> : !hasPackaging ? <section className="rounded-lg border border-dashed p-8 text-center"><h3 className="font-semibold">먼저 박스·파렛트 구성을 저장해주세요.</h3><p className="mt-1 text-sm text-muted-foreground">상품을 박스에 배정하려면 1단계에서 파렛트와 박스 수를 먼저 만들어야 합니다.</p><button type="button" onClick={() => onStageChange('setup')} className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">1단계로 이동</button></section> : <section className="space-y-4"><div className="rounded-lg border bg-muted/20 p-4"><h3 className="font-semibold">2단계 · 상품별 박스 배정</h3><p className="mt-1 text-sm text-muted-foreground">상품마다 전체 출고수량, 나눠 담은 박스 수, 박스 번호와 수량을 바로 확인하고 추가할 수 있습니다.</p></div><div className="space-y-3">{items.map((item) => { const allocations = boxItems.filter((boxItem) => boxItem.shipmentItemId === item.id); const draft = packingDrafts[item.id] ?? { boxId: firstOpenBoxId, quantity: '' }; const remainingQuantity = item.reservedQuantity - item.packedQuantity; return <article key={item.id} className="rounded-lg border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h4 className="truncate font-semibold">{item.productName}</h4><p className="mt-1 truncate text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</p></div><div className="grid grid-cols-3 divide-x rounded-md border bg-muted/20 text-center sm:min-w-[300px]"><PackingMetric label="전체 출고" value={item.reservedQuantity} /><PackingMetric label="박스 배정" value={item.packedQuantity} tone="emerald" /><PackingMetric label="남은 수량" value={remainingQuantity} tone="amber" /></div></div><div className="mt-3 rounded-md border bg-muted/10 p-3"><p className="text-xs font-medium text-muted-foreground">현재 배정 · {allocations.length.toLocaleString('ko-KR')}개 박스에 나눠 담음</p>{allocations.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">아직 배정한 박스가 없습니다.</p> : <div className="mt-2 flex flex-wrap gap-2">{allocations.map((allocation) => { const box = boxById.get(allocation.boxId); const pallet = box?.palletId ? palletById.get(box.palletId) : null; return <span key={allocation.id} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs"><span className="font-medium">{box?.boxNo ?? '박스 확인 필요'}</span><span className="text-muted-foreground">{pallet ? `· ${pallet.palletNo}` : ''} · {allocation.quantity.toLocaleString('ko-KR')}개</span>{editable ? <button type="button" disabled={isPending} aria-label={`${box?.boxNo ?? '박스'} 적재 삭제`} onClick={() => { if (window.confirm(`${box?.boxNo ?? '이 박스'}의 ${item.productName} 적재를 삭제할까요?`)) run(() => removeChinaOutboundBoxItemAction({ shipmentId: shipment.id, boxItemId: allocation.id }), '박스 적재를 삭제했습니다.') }} className="rounded p-0.5 text-red-600 hover:bg-red-50"><Trash2 className="size-3" /></button> : null}</span> })}</div>}</div>{editable && remainingQuantity > 0 ? <form onSubmit={(event) => addPacking(event, item)} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"><Field label="넣을 박스"><select value={draft.boxId} onChange={(event) => setPackingDraft(item.id, { boxId: event.target.value })} className={inputClass}>{openBoxes.map((box) => { const pallet = box.palletId ? palletById.get(box.palletId) : null; return <option key={box.id} value={box.id}>{box.boxNo}{pallet ? ` · ${pallet.palletNo}` : ''}</option> })}</select></Field><Field label="이번 배정 수량"><input type="number" min="1" max={remainingQuantity} step="1" value={draft.quantity} onChange={(event) => setPackingDraft(item.id, { quantity: event.target.value })} required className={inputClass} placeholder={`최대 ${remainingQuantity}`} /></Field><button type="submit" disabled={isPending || !firstOpenBoxId} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-muted disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Box className="size-4" />} 박스 배정</button></form> : null}</article> })}</div><BoxPackingOverview boxes={boxes} boxItemsByBox={boxItemsByBox} itemById={itemById} palletById={palletById} /></section>}
  </section>
}

function StageButton({ active, step, title, detail, onClick }: { active: boolean; step: string; title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-md px-3 py-2 text-left transition-colors ${active ? 'bg-background shadow-sm' : 'text-muted-foreground hover:bg-background/60'}`}><span className="block text-xs font-medium">{step}</span><span className="mt-0.5 block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs">{detail}</span></button>
}

function PackagingSetupOverview({ pallets, boxesByPallet }: { pallets: ChinaShipmentDetailView['pallets']; boxesByPallet: Map<string, ChinaShipmentDetailView['boxes']> }) {
  return <section className="rounded-lg border"><div className="border-b px-4 py-3"><h3 className="font-semibold">구성 미리보기</h3><p className="mt-1 text-xs text-muted-foreground">생성된 박스가 어떤 파렛트에 배정됐는지 확인합니다.</p></div><div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">{pallets.length === 0 ? <p className="p-5 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">파렛트와 박스 수를 입력하고 구성 저장을 눌러주세요.</p> : pallets.map((pallet) => { const palletBoxes = boxesByPallet.get(pallet.id) ?? []; return <article key={pallet.id} className="rounded-md border bg-muted/20 p-3"><p className="flex items-center gap-2 font-medium"><Container className="size-4" /> {pallet.palletNo}</p><p className="mt-2 text-xs text-muted-foreground">박스 {palletBoxes.length.toLocaleString('ko-KR')}개</p><div className="mt-2 flex flex-wrap gap-1.5">{palletBoxes.length === 0 ? <span className="text-xs text-muted-foreground">배정된 박스 없음</span> : palletBoxes.map((box) => <span key={box.id} className="rounded-full border bg-background px-2 py-1 text-xs">{box.boxNo}</span>)}</div></article> })}</div></section>
}

function BoxPackingOverview({ boxes, boxItemsByBox, itemById, palletById }: { boxes: ChinaShipmentDetailView['boxes']; boxItemsByBox: Map<string, ChinaShipmentDetailView['boxItems']>; itemById: Map<string, ChinaShipmentDetailView['items'][number]>; palletById: Map<string, ChinaShipmentDetailView['pallets'][number]> }) {
  return <section className="rounded-lg border"><div className="border-b px-4 py-3"><h3 className="font-semibold">박스별 적재 현황</h3><p className="mt-1 text-xs text-muted-foreground">각 박스 안에 어떤 상품이 몇 개 들어가는지 확인합니다.</p></div><div className="grid gap-3 p-3 md:grid-cols-2">{boxes.map((box) => { const pallet = box.palletId ? palletById.get(box.palletId) : null; const packedItems = boxItemsByBox.get(box.id) ?? []; return <article key={box.id} className="rounded-md border bg-muted/20 p-3"><div className="flex items-center justify-between gap-2"><p className="font-medium">{box.boxNo}</p><span className="text-xs text-muted-foreground">{pallet?.palletNo ?? '파렛트 미배정'}</span></div><ul className="mt-3 space-y-2">{packedItems.length === 0 ? <li className="text-sm text-muted-foreground">담긴 상품 없음</li> : packedItems.map((packedItem) => { const item = itemById.get(packedItem.shipmentItemId); return <li key={packedItem.id} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="truncate font-medium">{item?.productName ?? '상품 확인 필요'}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item ? `${item.sku}${item.optionName ? ` · ${item.optionName}` : ''} · 전체 ${item.reservedQuantity.toLocaleString('ko-KR')}개` : '-'}</p></div><span className="shrink-0 font-semibold tabular-nums">{packedItem.quantity.toLocaleString('ko-KR')}개</span></li> })}</ul></article> })}</div></section>
}

function PackingMetric({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'emerald' }) {
  const toneClass = tone === 'amber' ? 'text-amber-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-foreground'
  return <div className="px-2 py-2"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className={`mt-0.5 text-sm font-semibold tabular-nums ${toneClass}`}>{value.toLocaleString('ko-KR')}개</dd></div>
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'emerald' }) {
  const toneClass = tone === 'amber' ? 'border-amber-200 bg-amber-50/50 text-amber-800' : tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'bg-card'
  return <div className={`rounded-lg border p-4 ${toneClass}`}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString('ko-KR')}개</p></div>
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'dispatched' ? 'bg-emerald-100 text-emerald-800' : status === 'cancelled' ? 'bg-zinc-100 text-zinc-700' : status === 'ready' ? 'bg-blue-100 text-blue-800' : status === 'packing' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{statusLabels[status] ?? status}</span>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
}

function shipmentHref(shipmentId: string, stage: ChinaShipmentStage) {
  return `/purchasing/china-shipments?shipment=${encodeURIComponent(shipmentId)}&step=${stage}`
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function formatRegisteredDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

const inputClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'
