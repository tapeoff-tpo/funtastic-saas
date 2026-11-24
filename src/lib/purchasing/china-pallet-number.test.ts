import { expect, it } from 'vitest'
import { normalizeChinaPalletNumber } from './china-pallet-number'
it.each([null, undefined, '', ' ', 'box', 'Box', '박스', 'bxo', '7box', 'P1', '1파렛트', '-1', '1.5', '0'])('treats %s as loose boxes', (value) => {
  expect(normalizeChinaPalletNumber(value)).toBeNull()
})
it.each([['7','7'], [' 001 ','1'], ['７','7']])('normalizes numeric pallet %s', (input, output) => {
  expect(normalizeChinaPalletNumber(input)).toBe(output)
})

import { resolveChinaLooseBoxes } from './china-pallet-number'
it('counts 29 legacy box assignments as loose boxes while retaining six numeric pallets', () => {
  const pallets = [...Array.from({ length: 6 }, (_, n) => ({ id: 'p' + n, palletNo: String(n + 1) })), { id: 'loose', palletNo: 'box' }]
  const boxes = [...Array.from({ length: 29 }, () => ({ palletId: 'loose' })), { palletId: 'p0' }]
  const view = resolveChinaLooseBoxes(pallets, boxes)
  expect(view.pallets).toHaveLength(6)
  expect(view.boxes.filter((box) => box.palletId === null)).toHaveLength(29)
  expect(boxes[0].palletId).toBe('loose')
})
it('preserves historical P1 pallets and treats typo labels as loose boxes', () => {
  const view = resolveChinaLooseBoxes([{ id: 'valid', palletNo: 'P1' }, { id: 'typo', palletNo: 'bxo' }], [{ palletId: 'valid' }, { palletId: 'typo' }])
  expect(view.pallets.map((p) => p.id)).toEqual(['valid'])
  expect(view.boxes.map((b) => b.palletId)).toEqual(['valid', null])
})
