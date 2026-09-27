import { describe, expect, it } from 'vitest'
import { normalizeInventoryProductName } from './product-name'

describe('normalizeInventoryProductName', () => {
  it('removes the Sabangnet _펀타스틱 suffix', () => {
    expect(normalizeInventoryProductName('파스텔 휴대용 약통_펀타스틱')).toBe('파스텔 휴대용 약통')
  })

  it('removes repeated suffixes and leaves no trailing underscore', () => {
    expect(normalizeInventoryProductName('약통_펀타스틱_펀타스틱_')).toBe('약통')
    expect(normalizeInventoryProductName('약통_펀타스틱_ ')).toBe('약통')
  })

  it('keeps normal product names unchanged', () => {
    expect(normalizeInventoryProductName('파스텔 휴대용 약통')).toBe('파스텔 휴대용 약통')
  })
})
