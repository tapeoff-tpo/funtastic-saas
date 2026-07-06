import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { buildWarehouseSelectionHaving } from './queries'

describe('inventory warehouse selection', () => {
  it('filters grouped SKUs without removing other warehouse rows from the stock total', () => {
    const condition = buildWarehouseSelectionHaving('쿠팡')
    const query = new PgDialect().sqlToQuery(condition!)

    expect(query.sql).toContain('BOOL_OR')
    expect(query.params).toEqual(['쿠팡'])
  })

  it('does not add a grouped warehouse condition when all warehouses are selected', () => {
    expect(buildWarehouseSelectionHaving(undefined)).toBeUndefined()
  })
})
