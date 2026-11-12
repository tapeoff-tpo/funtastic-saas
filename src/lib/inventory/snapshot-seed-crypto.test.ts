import { describe, expect, it } from 'vitest'
import { decryptSnapshotSeed, encryptSnapshotSeed, snapshotImportPublicKey } from './snapshot-seed-crypto.mjs'

describe('private inventory migration payloads', () => {
  it('round trips source data without publishing it or accepting another environment key', () => {
    const source = { month: '2026-09', sourceHash: 'hash', rows: [['SKU', 15]] }
    const encrypted = encryptSnapshotSeed(snapshotImportPublicKey('test-database-url'), source)
    expect(JSON.stringify(encrypted)).not.toContain('SKU')
    expect(decryptSnapshotSeed('test-database-url', encrypted)).toEqual(source)
    expect(() => decryptSnapshotSeed('other-database-url', encrypted)).toThrow()
    expect(() => decryptSnapshotSeed('test-database-url', { ...encrypted, month: '2026-10' })).toThrow()
  })
})
