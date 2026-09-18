'use client'

import { type FormEvent, type ReactNode, type TransitionStartFunction, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Box, Check, Container, Loader2, PackagePlus, Plus, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  addChinaOutboundBoxAction,
  addChinaOutboundBoxItemAction,
  addChinaOutboundPalletAction,
  cancelChinaOutboundShipmentAction,
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
  }
  items: Array<{
    id: string
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

type InventorySummary = {
  onHandQuantity: number
  reservedQuantity: number
  availableQuantity: number
}

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
  inventorySummary,
  shipments,
  selectedShipment,
}: {
  inventoryItems: ChinaShipmentStockItem[]
  inventorySummary: InventorySummary
  shipments: ChinaShipmentListItem[]
  selectedShipment: ChinaShipmentDetailView | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const warehouseOptions = useMemo(() => [...new Set(inventoryItems.map((item) => item.warehouseCode))], [inventoryItems])
  const [warehouseCode, setWarehouseCode] = useState(warehouseOptions[0] ?? '')
  const [showCreate, setShowCreate] = useState(shipments.length === 0)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [shipmentNo, setShipmentNo] = useState('')
  const [destinationName, setDestinationName] = useState('')
  const [plannedOutboundDate, setPlannedOutboundDate] = useState(today())
  const [memo, setMemo] = useState('')

  const selectedWarehouseCode = warehouseOptions.includes(warehouseCode) ? warehouseCode : (warehouseOptions[0] ?? '')
  const warehouseInventory = inventoryItems.filter((item) => item.warehouseCode === selectedWarehouseCode && item.availableQuantity > 0)

  function createShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const lines = warehouseInventory.flatMap((item) => {
      const quantity = Number(quantities[item.id] ?? 0)
      return Number.isInteger(quantity) && quantity > 0 ? [{ inventoryId: item.id, quantity }] : []
    })
    startTransition(async () => {
      const result = await createChinaOutboundShipmentAction({
        shipmentNo,
        destinationName,
        plannedOutboundDate: plannedOutboundDate || null,
        memo,
        lines,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('중국출고 작업을 만들고 재고를 예약했습니다.')
      setShowCreate(false)
      setQuantities({})
      setShipmentNo('')
      setDestinationName('')
      setMemo('')
      router.push(`/purchasing/china-shipments?shipment=${result.shipmentId}`)
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
          <div>
            <h2 className="font-semibold">새 중국출고 작업</h2>
            <p className="mt-1 text-xs text-muted-foreground">중국 내 출발 창고를 선택한 뒤 수량을 예약합니다. 기존 Ecount 중국재고는 변경하지 않습니다.</p>
          </div>
          <button type="button" onClick={() => setShowCreate((open) => !open)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
            <PackagePlus className="size-4" />
            {showCreate ? '작업 생성 닫기' : '새 출고작업'}
          </button>
        </div>
        {showCreate ? (
          <form onSubmit={createShipment} className="space-y-4 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="출고 출발 창고">
                <select value={selectedWarehouseCode} onChange={(event) => { setWarehouseCode(event.target.value); setQuantities({}) }} className={inputClass} required>
                  {warehouseOptions.length === 0 ? <option value="">등록된 SaaS 중국재고 없음</option> : warehouseOptions.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
                </select>
              </Field>
              <Field label="쉽먼트 번호">
                <input value={shipmentNo} onChange={(event) => setShipmentNo(event.target.value)} className={inputClass} placeholder="비우면 자동 생성" />
              </Field>
              <Field label="도착지">
                <input value={destinationName} onChange={(event) => setDestinationName(event.target.value)} className={inputClass} placeholder="예: 한국 1창고" />
              </Field>
              <Field label="출고예정일">
                <input type="date" value={plannedOutboundDate} onChange={(event) => setPlannedOutboundDate(event.target.value)} className={inputClass} />
              </Field>
            </div>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">메모</span>
              <input value={memo} onChange={(event) => setMemo(event.target.value)} className={inputClass} placeholder="포워더, 출고 목적 등" />
            </label>
            <div className="space-y-2 md:hidden">
              {warehouseInventory.length === 0 ? <p className="rounded-md border px-3 py-10 text-center text-sm text-muted-foreground">선택한 창고에 출고 가능한 SaaS 재고가 없습니다. 중국재고(SaaS)에서 테스트 재고를 먼저 추가해주세요.</p> : warehouseInventory.map((item) => (
                <article key={item.id} className="rounded-lg border bg-background p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.productName}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</p>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 divide-x rounded-md border bg-muted/20 text-center">
                    <StockMetric label="현재고" value={item.onHandQuantity} />
                    <StockMetric label="기존 예약" value={item.reservedQuantity} tone="amber" />
                    <StockMetric label="작업 가능" value={item.availableQuantity} tone="emerald" />
                  </dl>
                  <label className="mt-3 block">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">이번 출고 수량</span>
                    <input type="number" min="0" max={item.availableQuantity} step="1" value={quantities[item.id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="h-11 w-full rounded-md border bg-background px-3 text-right text-base tabular-nums" placeholder="0" />
                  </label>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-md border md:block">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2">상품</th><th className="px-3 py-2 text-right">현재고</th><th className="px-3 py-2 text-right">기존 예약</th><th className="px-3 py-2 text-right">작업 가능</th><th className="px-3 py-2 text-right">이번 출고</th></tr></thead>
                <tbody>
                  {warehouseInventory.length === 0 ? <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">선택한 창고에 출고 가능한 SaaS 재고가 없습니다. 중국재고(SaaS)에서 테스트 재고를 먼저 추가해주세요.</td></tr> : warehouseInventory.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2"><div className="font-medium">{item.productName}</div><div className="text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</div></td>
                      <td className="px-3 py-2 text-right tabular-nums">{item.onHandQuantity.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{item.reservedQuantity.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-emerald-700">{item.availableQuantity.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2 text-right"><input type="number" min="0" max={item.availableQuantity} step="1" value={quantities[item.id] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="h-8 w-24 rounded-md border bg-background px-2 text-right tabular-nums" placeholder="0" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end"><button type="submit" disabled={isPending || warehouseInventory.length === 0} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">{isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 출고작업 만들기</button></div>
          </form>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
        <ShipmentList shipments={shipments} selectedShipmentId={selectedShipment?.shipment.id} onSelect={(id) => router.push(`/purchasing/china-shipments?shipment=${id}`)} />
        <ShipmentDetailPanel key={selectedShipment?.shipment.id ?? 'no-shipment'} detail={selectedShipment} isPending={isPending} startTransition={startTransition} router={router} />
      </div>
    </div>
  )
}

function ShipmentList({ shipments, selectedShipmentId, onSelect }: { shipments: ChinaShipmentListItem[]; selectedShipmentId?: string; onSelect: (id: string) => void }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b px-4 py-3"><h2 className="font-semibold">출고작업 목록</h2><p className="mt-1 text-xs text-muted-foreground">총 {shipments.length.toLocaleString('ko-KR')}건</p></div>
      <div className="max-h-[720px] overflow-y-auto p-2">
        {shipments.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">아직 만든 출고작업이 없습니다.</p> : shipments.map((shipment) => {
          const selected = shipment.id === selectedShipmentId
          return <button key={shipment.id} type="button" onClick={() => onSelect(shipment.id)} className={`mb-1 w-full rounded-md border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted'}`}>
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{shipment.shipmentNo}</span><StatusBadge status={shipment.status} /></div>
            <p className="mt-1 text-xs text-muted-foreground">{shipment.originWarehouseCode} · {shipment.destinationName || '도착지 미입력'}</p>
            <p className="mt-2 text-xs tabular-nums text-muted-foreground">상품 {shipment.itemCount}종 · {shipment.packedQuantity.toLocaleString('ko-KR')} / {shipment.reservedQuantity.toLocaleString('ko-KR')}개 포장</p>
          </button>
        })}
      </div>
    </section>
  )
}

function ShipmentDetailPanel({ detail, isPending, startTransition, router }: { detail: ChinaShipmentDetailView | null; isPending: boolean; startTransition: TransitionStartFunction; router: ReturnType<typeof useRouter> }) {
  const [palletNo, setPalletNo] = useState('')
  const [boxNo, setBoxNo] = useState('')
  const [boxPalletId, setBoxPalletId] = useState('')
  const [packingBoxId, setPackingBoxId] = useState('')
  const [packingItemId, setPackingItemId] = useState('')
  const [packingQuantity, setPackingQuantity] = useState('')

  if (!detail) {
    return <section className="flex min-h-[360px] items-center justify-center rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">왼쪽에서 출고작업을 선택하면 상품·파렛트·박스 적재 작업을 할 수 있습니다.</section>
  }

  const { shipment, items, pallets, boxes, boxItems } = detail
  const editable = editableStatuses.has(shipment.status)
  const itemById = new Map(items.map((item) => [item.id, item]))
  const boxesByPallet = new Map(pallets.map((pallet) => [pallet.id, boxes.filter((box) => box.palletId === pallet.id)]))
  const unassignedBoxes = boxes.filter((box) => !box.palletId)
  const boxItemsByBox = new Map(boxes.map((box) => [box.id, boxItems.filter((item) => item.boxId === box.id)]))

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? '처리하지 못했습니다.')
        return
      }
      toast.success(successMessage)
      router.refresh()
    })
  }

  function addPallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    run(() => addChinaOutboundPalletAction({ shipmentId: shipment.id, palletNo }), '파렛트를 추가했습니다.')
    setPalletNo('')
  }

  function addBox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    run(() => addChinaOutboundBoxAction({ shipmentId: shipment.id, boxNo, palletId: boxPalletId }), '박스를 추가했습니다.')
    setBoxNo('')
  }

  function addPacking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    run(() => addChinaOutboundBoxItemAction({ shipmentId: shipment.id, boxId: packingBoxId, shipmentItemId: packingItemId, quantity: Number(packingQuantity) }), '박스에 상품을 적재했습니다.')
    setPackingQuantity('')
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{shipment.shipmentNo}</h2><StatusBadge status={shipment.status} /></div>
          <p className="mt-1 text-sm text-muted-foreground">{shipment.originWarehouseCode} → {shipment.destinationName || '도착지 미입력'}{shipment.plannedOutboundDate ? ` · ${shipment.plannedOutboundDate}` : ''}</p>
          {shipment.memo ? <p className="mt-1 text-xs text-muted-foreground">메모: {shipment.memo}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable ? <button type="button" disabled={isPending} onClick={() => run(() => markChinaOutboundShipmentReadyAction({ shipmentId: shipment.id }), '포장완료로 전환했습니다.')} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"><Check className="size-4" /> 포장완료</button> : null}
          {shipment.status === 'ready' ? <button type="button" disabled={isPending} onClick={() => { if (window.confirm('포장된 수량을 SaaS 중국재고에서 차감하고 출고완료 처리할까요?')) run(() => dispatchChinaOutboundShipmentAction({ shipmentId: shipment.id }), '출고완료 처리했습니다. SaaS 재고가 차감되었습니다.') }} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"><Send className="size-4" /> 출고완료</button> : null}
          {shipment.status !== 'dispatched' && shipment.status !== 'cancelled' ? <button type="button" disabled={isPending} onClick={() => { if (window.confirm('이 출고작업을 취소하고 예약 수량을 풀까요?')) run(() => cancelChinaOutboundShipmentAction({ shipmentId: shipment.id }), '출고작업을 취소하고 재고 예약을 풀었습니다.') }} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"><Trash2 className="size-4" /> 작업 취소</button> : null}
        </div>
      </div>

      <section className="rounded-md border">
        <div className="border-b px-3 py-2"><h3 className="text-sm font-semibold">출고 상품 · 포장 진행</h3></div>
        <div className="space-y-2 p-3 md:hidden">
          {items.map((item) => (
            <article key={item.id} className="rounded-lg border bg-background p-3">
              <p className="truncate font-medium">{item.productName}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</p>
              <dl className="mt-3 grid grid-cols-3 divide-x rounded-md border bg-muted/20 text-center">
                <StockMetric label="출고 예약" value={item.reservedQuantity} />
                <StockMetric label="박스 적재" value={item.packedQuantity} tone="emerald" />
                <StockMetric label="미포장" value={item.reservedQuantity - item.packedQuantity} tone="amber" />
              </dl>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2">상품</th><th className="px-3 py-2 text-right">출고 예약</th><th className="px-3 py-2 text-right">박스 적재</th><th className="px-3 py-2 text-right">미포장</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t"><td className="px-3 py-2"><div className="font-medium">{item.productName}</div><div className="text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</div></td><td className="px-3 py-2 text-right tabular-nums">{item.reservedQuantity.toLocaleString('ko-KR')}</td><td className="px-3 py-2 text-right font-medium tabular-nums text-emerald-700">{item.packedQuantity.toLocaleString('ko-KR')}</td><td className="px-3 py-2 text-right tabular-nums text-amber-700">{(item.reservedQuantity - item.packedQuantity).toLocaleString('ko-KR')}</td></tr>)}</tbody></table></div>
      </section>

      {editable ? <div className="grid gap-4 lg:grid-cols-3">
        <form onSubmit={addPallet} className="rounded-md border p-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Container className="size-4" /> 파렛트 추가</h3><div className="mt-3 flex gap-2"><input value={palletNo} onChange={(event) => setPalletNo(event.target.value)} className={inputClass} required placeholder="예: PLT-01" /><button disabled={isPending} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted"><Plus className="size-4" /> 추가</button></div></form>
        <form onSubmit={addBox} className="rounded-md border p-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Archive className="size-4" /> 박스 추가</h3><div className="mt-3 grid gap-2"><select value={boxPalletId} onChange={(event) => setBoxPalletId(event.target.value)} required className={inputClass}><option value="">파렛트를 먼저 선택하세요</option>{pallets.map((pallet) => <option key={pallet.id} value={pallet.id}>{pallet.palletNo}</option>)}</select><div className="flex gap-2"><input value={boxNo} onChange={(event) => setBoxNo(event.target.value)} className={inputClass} required placeholder="예: BOX-001" /><button disabled={isPending || pallets.length === 0} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-60"><Plus className="size-4" /> 추가</button></div>{pallets.length === 0 ? <p className="text-xs text-muted-foreground">박스를 추가하려면 먼저 파렛트를 등록해주세요.</p> : null}</div></form>
        <form onSubmit={addPacking} className="rounded-md border p-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Box className="size-4" /> 박스에 상품 담기</h3><div className="mt-3 grid gap-2"><select value={packingBoxId} onChange={(event) => setPackingBoxId(event.target.value)} required className={inputClass}><option value="">박스 선택</option>{boxes.map((box) => <option key={box.id} value={box.id}>{box.boxNo}</option>)}</select><select value={packingItemId} onChange={(event) => setPackingItemId(event.target.value)} required className={inputClass}><option value="">출고 상품 선택</option>{items.filter((item) => item.packedQuantity < item.reservedQuantity).map((item) => <option key={item.id} value={item.id}>{item.sku} · 미포장 {item.reservedQuantity - item.packedQuantity}개</option>)}</select><div className="flex gap-2"><input type="number" min="1" step="1" value={packingQuantity} onChange={(event) => setPackingQuantity(event.target.value)} required className={inputClass} placeholder="수량" /><button disabled={isPending} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted"><Plus className="size-4" /> 담기</button></div></div></form>
      </div> : null}

      <section className="rounded-md border"><div className="border-b px-3 py-2"><h3 className="text-sm font-semibold">파렛트 · 박스 적재 현황</h3><p className="mt-1 text-xs text-muted-foreground">박스가 어떤 파렛트에 있고, 박스마다 어떤 상품이 몇 개 담겼는지 확인합니다.</p></div><div className="grid gap-3 p-3 md:grid-cols-2">{pallets.length === 0 && unassignedBoxes.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground md:col-span-2">파렛트와 박스를 추가하면 적재 현황이 표시됩니다.</p> : null}{pallets.map((pallet) => <PalletCard key={pallet.id} palletNo={pallet.palletNo} boxes={boxesByPallet.get(pallet.id) ?? []} boxItemsByBox={boxItemsByBox} itemById={itemById} editable={editable} shipmentId={shipment.id} isPending={isPending} startTransition={startTransition} router={router} />)}{unassignedBoxes.length > 0 ? <PalletCard palletNo="파렛트 미배치" boxes={unassignedBoxes} boxItemsByBox={boxItemsByBox} itemById={itemById} editable={editable} shipmentId={shipment.id} isPending={isPending} startTransition={startTransition} router={router} /> : null}</div></section>
    </section>
  )
}

function PalletCard({ palletNo, boxes, boxItemsByBox, itemById, editable, shipmentId, isPending, startTransition, router }: { palletNo: string; boxes: ChinaShipmentDetailView['boxes']; boxItemsByBox: Map<string, ChinaShipmentDetailView['boxItems']>; itemById: Map<string, ChinaShipmentDetailView['items'][number]>; editable: boolean; shipmentId: string; isPending: boolean; startTransition: TransitionStartFunction; router: ReturnType<typeof useRouter> }) {
  return <div className="rounded-md border bg-muted/20 p-3"><h4 className="flex items-center gap-2 text-sm font-semibold"><Container className="size-4" /> {palletNo}</h4><div className="mt-3 space-y-2">{boxes.length === 0 ? <p className="text-xs text-muted-foreground">배치된 박스가 없습니다.</p> : boxes.map((box) => <div key={box.id} className="rounded border bg-background p-2"><div className="flex items-center justify-between"><span className="font-medium text-sm">{box.boxNo}</span><span className="text-xs text-muted-foreground">{box.status === 'sealed' ? '봉인' : '작업중'}</span></div><ul className="mt-2 space-y-1">{(boxItemsByBox.get(box.id) ?? []).length === 0 ? <li className="text-xs text-muted-foreground">담긴 상품 없음</li> : (boxItemsByBox.get(box.id) ?? []).map((boxItem) => { const item = itemById.get(boxItem.shipmentItemId); return <li key={boxItem.id} className="flex items-center justify-between gap-2 text-xs"><span>{item ? `${item.sku}${item.optionName ? ` · ${item.optionName}` : ''}` : '상품 확인 필요'}</span><span className="flex items-center gap-1 font-medium tabular-nums">{boxItem.quantity.toLocaleString('ko-KR')}개{editable ? <button type="button" disabled={isPending} aria-label="박스 적재 삭제" onClick={() => { if (!window.confirm('이 박스의 상품 적재를 삭제할까요?')) return; startTransition(async () => { const result = await removeChinaOutboundBoxItemAction({ shipmentId, boxItemId: boxItem.id }); if (!result.ok) { toast.error(result.error); return } toast.success('박스 적재를 삭제했습니다.'); router.refresh() }) }} className="rounded p-0.5 text-red-600 hover:bg-red-50"><Trash2 className="size-3" /></button> : null}</span></li> })}</ul></div>)}</div></div>
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'emerald' }) {
  const toneClass = tone === 'amber' ? 'border-amber-200 bg-amber-50/50 text-amber-800' : tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'bg-card'
  return <div className={`rounded-lg border p-4 ${toneClass}`}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString('ko-KR')}개</p></div>
}

function StockMetric({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'emerald' }) {
  const toneClass = tone === 'amber' ? 'text-amber-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-foreground'
  return <div className="px-1.5 py-2"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className={`mt-0.5 text-sm font-semibold tabular-nums ${toneClass}`}>{value.toLocaleString('ko-KR')}</dd></div>
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'dispatched' ? 'bg-emerald-100 text-emerald-800' : status === 'cancelled' ? 'bg-zinc-100 text-zinc-700' : status === 'ready' ? 'bg-blue-100 text-blue-800' : status === 'packing' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{statusLabels[status] ?? status}</span>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

const inputClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'
