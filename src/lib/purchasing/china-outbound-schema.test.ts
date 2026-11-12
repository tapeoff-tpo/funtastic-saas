import { describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { chinaOutboundSchemaProbe, createChinaOutboundSchemaInitializer } from './china-outbound-schema'

describe('China outbound schema initialization', () => {
  it('uses a read-only probe and skips bootstrap DDL for an initialized database', async () => {
    const execute = vi.fn().mockResolvedValue([{ ready: true }])
    const ensure = createChinaOutboundSchemaInitializer(execute, sql`ALTER TABLE example ADD COLUMN value text`)
    await Promise.all([ensure(), ensure(), ensure()])
    expect(execute).toHaveBeenCalledOnce()
    const query = new PgDialect().sqlToQuery(chinaOutboundSchemaProbe)
    expect(query.sql.replace(/'[^']*'/g, '"literal"')).not.toMatch(/\b(ALTER|CREATE|UPDATE|INSERT|DELETE|REVOKE)\b/i)
    expect(query.sql).toContain('relrowsecurity')
    expect(query.sql).toContain('has_table_privilege')
    expect(query.sql).toContain('indisvalid')
    expect(query.params.join(' ')).toContain('chinese_product_name')
    expect(query.params.join(' ')).toContain('inspection_boxes')
  })
  it('keeps the complete bootstrap for missing columns, indexes, or security protections', async () => {
    const bootstrap = sql`SELECT 'bootstrap'`
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ ready: false }] }).mockResolvedValue(undefined)
    const ensure = createChinaOutboundSchemaInitializer(execute, bootstrap)
    await ensure(); await ensure()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenLastCalledWith(bootstrap)
  })
  it('retries after a failed database connection rather than caching the failure', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error('connection')).mockResolvedValue([{ ready: true }])
    const ensure = createChinaOutboundSchemaInitializer(execute, sql`SELECT 'bootstrap'`)
    await expect(ensure()).rejects.toThrow('connection')
    await ensure()
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
