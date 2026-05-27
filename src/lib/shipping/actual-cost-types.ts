export type ActualShippingCostCarrier = 'CJGLS' | 'KDEXP' | 'DAESIN'

export const ACTUAL_SHIPPING_COST_CARRIERS: Array<{
  id: ActualShippingCostCarrier
  name: string
}> = [
  { id: 'CJGLS', name: 'CJ대한통운' },
  { id: 'KDEXP', name: '경동택배' },
  { id: 'DAESIN', name: '대신택배' },
]
