import { describe, expect, it } from 'vitest'
import {
  packPurchasingRawDataBundle,
  unpackPurchasingRawDataBundle,
  type PurchasingRawDataBundleFields,
} from './raw-data-upload-bundle'

const fields: PurchasingRawDataBundleFields = {
  mode: 'preview',
  asOfDate: '2026-09-11',
  domesticInventoryReflectedThrough: '2026-09-11',
  purchasePlanConfirmedSince: '2026-07-01',
}

describe('purchasing raw-data upload bundle', () => {
  it('round-trips arbitrary filenames and workbook bytes', async () => {
    const files = [
      new File(['outbound workbook'], '8G9KT07OSOXDP52.xlsx'),
      new File(['inventory workbook'], 'ESZ018R (29).xlsx'),
    ]

    const packed = await packPurchasingRawDataBundle(fields, files)
    const unpacked = unpackPurchasingRawDataBundle(packed)

    expect(unpacked.fields).toEqual(fields)
    expect(unpacked.files.map((file) => file.name)).toEqual(files.map((file) => file.name))
    await expect(new Blob([unpacked.files[0].bytes as BlobPart]).text()).resolves.toBe('outbound workbook')
    await expect(new Blob([unpacked.files[1].bytes as BlobPart]).text()).resolves.toBe('inventory workbook')
  })

  it('rejects a truncated bundle before any workbook is processed', async () => {
    const packed = await packPurchasingRawDataBundle(fields, [new File(['workbook'], 'report.xlsx')])

    expect(() => unpackPurchasingRawDataBundle(packed.subarray(0, packed.byteLength - 1)))
      .toThrow('압축 업로드 데이터가 잘렸습니다.')
  })
})
