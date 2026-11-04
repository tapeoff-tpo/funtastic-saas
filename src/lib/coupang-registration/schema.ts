import { z } from 'zod'
import { MONEY_LIMIT } from './model'

const amount = z.number().finite().min(0).max(MONEY_LIMIT).nullable()
const text = z.string().max(32767)
const file = z.object({ name: z.string().min(1).max(250).refine((value) => !/[\\/]/.test(value), '파일명에 경로를 포함할 수 없습니다.'), data: z.string().max(20_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/) })
export const rowSchema = z.object({
  id: z.string().min(1).max(100), templateId: z.string().max(100), sheetName: z.string().max(100), name: z.string().max(500), optionName: z.string().max(300), internalSku: z.string().max(100),
  costPrice: amount, wholesalePrice: amount, priceMode: z.enum(['wholesale', 'markup', 'manual']), markupPercent: z.number().finite().min(0).max(1000), manualSupplyPrice: amount,
  sourceCode: z.string().max(100), sourceName: z.string().max(500), sourceStatus: z.string().max(50), bundleReviewed: z.boolean(), primaryImage: z.string().max(4000),
  thumbnails: z.array(z.string().max(4000)).max(30), detailImages: z.array(z.string().max(4000)).max(100), label: z.string().max(4000), fields: z.record(z.string().max(200), text),
})
export const draftSchema = z.object({
  name: z.string().trim().min(1).max(100), rounding: z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]), rows: z.array(rowSchema).max(500),
  templates: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().max(250), file, sheets: z.array(z.object({ name: z.string().max(100), columns: z.array(z.object({ column: z.number().int().min(1).max(200), label: z.string().max(200), requirement: z.string().max(100), guide: z.string().max(10000) })).max(200) })).max(20) })).max(6),
  labels: z.array(file).max(100),
})
