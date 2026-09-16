import { describe, expect, it } from 'vitest'
import {
  recalculateChinaFundStatementBalances,
  sortChinaFundStatementLedgerRows,
} from './china-fund-statement-ledger'

describe('china fund statement ledger', () => {
  const rows = [
    {
      id: 'later',
      occurredOn: '2026-09-14',
      sequence: 2,
      createdAt: '2026-09-16T02:00:00.000Z',
      signedAmountCny: 1_435.18,
    },
    {
      id: 'first',
      occurredOn: '2026-09-10',
      sequence: 0,
      createdAt: '2026-09-16T02:00:00.000Z',
      signedAmountCny: 30_000,
    },
    {
      id: 'same-day-first',
      occurredOn: '2026-09-14',
      sequence: 1,
      createdAt: '2026-09-16T02:00:00.000Z',
      signedAmountCny: -98_151.9,
    },
  ]

  it('sorts by date and original entry order', () => {
    expect(sortChinaFundStatementLedgerRows(rows).map((row) => row.id)).toEqual([
      'first',
      'same-day-first',
      'later',
    ])
  })

  it('recalculates downstream balances after an individual row changes or is removed', () => {
    expect(recalculateChinaFundStatementBalances(rows, 36_716.72)).toMatchObject([
      { id: 'first', balanceAfterCny: 66_716.72 },
      { id: 'same-day-first', balanceAfterCny: -31_435.18 },
      { id: 'later', balanceAfterCny: -30_000 },
    ])

    expect(recalculateChinaFundStatementBalances(
      rows.filter((row) => row.id !== 'same-day-first'),
      36_716.72,
    )).toMatchObject([
      { id: 'first', balanceAfterCny: 66_716.72 },
      { id: 'later', balanceAfterCny: 68_151.9 },
    ])
  })
})
