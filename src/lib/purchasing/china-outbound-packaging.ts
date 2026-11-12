import { calculateChinaOutboundBoxCbm, type ChinaOutboundBoxDimensions } from './china-outbound-dimensions'

/** Keep the dimensions of a real box, rather than synthesising per-axis maxima. */
export function largestChinaOutboundBox<T extends ChinaOutboundBoxDimensions>(boxes: T[]): T | undefined {
  return boxes.reduce<T | undefined>((largest, box) => {
    const volume = calculateChinaOutboundBoxCbm(box)
    const previous = largest ? calculateChinaOutboundBoxCbm(largest) : null
    return !largest || (volume != null && (previous == null || volume > previous)) ? box : largest
  }, undefined)
}

export function chinaStockDate(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function matchesChinaStockPeriod(value: string | null | undefined, from: string, to: string) {
  if (!from && !to) return true
  const day = chinaStockDate(value)
  return !!day && (!from || day >= from) && (!to || day <= to)
}
