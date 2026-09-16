export type ChinaFundStatementLedgerRow = {
  id: string
  occurredOn: string
  sequence: number
  createdAt: Date | string
  signedAmountCny: number
}

export type ChinaFundStatementLedgerBalance<T extends ChinaFundStatementLedgerRow> = T & {
  balanceAfterCny: number
}

export function sortChinaFundStatementLedgerRows<T extends ChinaFundStatementLedgerRow>(
  rows: readonly T[],
) {
  return [...rows].sort((left, right) => {
    const dateOrder = left.occurredOn.localeCompare(right.occurredOn)
    if (dateOrder !== 0) return dateOrder

    const createdAtOrder = timestampValue(left.createdAt) - timestampValue(right.createdAt)
    if (createdAtOrder !== 0) return createdAtOrder

    const sequenceOrder = left.sequence - right.sequence
    if (sequenceOrder !== 0) return sequenceOrder

    return left.id.localeCompare(right.id)
  })
}

export function recalculateChinaFundStatementBalances<T extends ChinaFundStatementLedgerRow>(
  rows: readonly T[],
  openingBalanceCny: number,
): Array<ChinaFundStatementLedgerBalance<T>> {
  let balanceAfterCny = roundChinaFundStatementCny(openingBalanceCny)

  return sortChinaFundStatementLedgerRows(rows).map((row) => {
    balanceAfterCny = roundChinaFundStatementCny(balanceAfterCny + row.signedAmountCny)
    return {
      ...row,
      balanceAfterCny,
    }
  })
}

export function roundChinaFundStatementCny(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function timestampValue(value: Date | string) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}
