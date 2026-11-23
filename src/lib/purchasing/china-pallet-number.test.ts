import { expect, it } from 'vitest'
import { normalizeChinaPalletNumber } from './china-pallet-number'
it.each([null, undefined, '', ' ', 'box', 'Box', '박스', 'bxo', '7box', 'P1', '1파렛트', '-1', '1.5', '0'])('treats %s as loose boxes', (value) => {
  expect(normalizeChinaPalletNumber(value)).toBeNull()
})
it.each([['7','7'], [' 001 ','1'], ['７','7']])('normalizes numeric pallet %s', (input, output) => {
  expect(normalizeChinaPalletNumber(input)).toBe(output)
})
