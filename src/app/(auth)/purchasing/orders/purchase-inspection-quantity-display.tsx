export function PurchaseInspectionQuantityDisplay({
  receivedQuantity,
  actualPurchaseQuantity,
  requestedQuantity,
}: {
  receivedQuantity: number | null
  actualPurchaseQuantity: number | null
  requestedQuantity: number
}) {
  const purchasedQuantity = actualPurchaseQuantity ?? requestedQuantity
  return <div className="inline-block py-1">
    <div aria-label="실제 입고수량" className={`font-medium ${receivedQuantity === null ? 'text-muted-foreground' : ''}`}>
      {receivedQuantity === null ? '미입력' : <span data-no-translate>{receivedQuantity.toLocaleString('ko-KR')}</span>}
    </div>
    <div className="mt-0.5 whitespace-nowrap text-[11px] font-normal text-muted-foreground">
      <span>구매수량</span>{' '}<span data-no-translate>{purchasedQuantity.toLocaleString('ko-KR')}</span>
    </div>
  </div>
}
