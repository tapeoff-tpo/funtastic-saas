import { calculatePrice, confirmPricing, getRegistrationStage, imageStem, isRegistrationSubmissionActive, priceIssues, type RegistrationDraft } from './model'

/** Browser saves may edit preparation, but may never manufacture a Hub receipt. */
export function prepareDraftSave(incoming: RegistrationDraft, existing?: RegistrationDraft): RegistrationDraft {
  if (new Set(incoming.rows.map((row) => row.id)).size !== incoming.rows.length) throw new Error('같은 상품 행이 중복되었습니다. 작업을 다시 불러와주세요.')
  if (new Set(incoming.templates.map((template) => template.id)).size !== incoming.templates.length) throw new Error('견적서가 중복되었습니다. 작업을 다시 불러와주세요.')
  if (new Set(incoming.labels.map((label) => imageStem(label.name))).size !== incoming.labels.length) throw new Error('품질표시 파일명이 중복되었습니다.')
  const previous = new Map(existing?.rows.map((row) => [row.id, row]) ?? [])
  const locked = (row: RegistrationDraft['rows'][number]) => getRegistrationStage(row) === 'registered'
    || isRegistrationSubmissionActive(row) || row.submission?.status === 'login_required'
  const rows = incoming.rows.map((row) => {
    const old = previous.get(row.id)
    if (old && locked(old)) return old
    const { submission: _submission, registeredAt: _registeredAt, ...editable } = row
    void _submission; void _registeredAt
    if (row.stage === 'information') {
      const issues = priceIssues(row, incoming.rounding)
      if (issues.length) throw new Error(`${row.name}: ${issues.join(' ')}`)
      if (old && getRegistrationStage(old) === 'information') {
        const previousPrices = calculatePrice(old, existing!.rounding)
        const incomingPrices = calculatePrice(row, incoming.rounding)
        if (incomingPrices.supply !== previousPrices.supply || incomingPrices.sale !== previousPrices.sale) throw new Error(`${row.name}: 가격을 변경하려면 판매가설정으로 되돌려주세요.`)
        return {
          ...editable, stage: 'information' as const, priceConfirmedAt: old.priceConfirmedAt ?? new Date().toISOString(),
          priceMode: 'manual' as const, manualSupplyPrice: previousPrices.supply, saleMode: 'manual' as const, manualSalePrice: previousPrices.sale,
          submission: old.submission?.status === 'failed' ? old.submission : undefined,
        }
      }
      return confirmPricing({ ...editable, stage: 'pricing', priceConfirmedAt: undefined }, incoming.rounding)
    }
    return { ...editable, stage: 'pricing' as const, priceConfirmedAt: undefined }
  })
  for (const old of previous.values()) {
    if (locked(old) && !rows.some((row) => row.id === old.id)) rows.push(old)
  }
  if (rows.length > 500) throw new Error('진행 중이거나 등록완료된 상품을 포함해 한 작업에는 최대 500개까지 저장할 수 있습니다.')
  // Template/label bytes used by an in-flight or registered row must remain available.
  const retainedRows = rows.filter(locked)
  const templates = [...incoming.templates]
  for (const template of existing?.templates ?? []) {
    if (!retainedRows.some((row) => row.templateId === template.id)) continue
    const index = templates.findIndex((item) => item.id === template.id)
    if (index < 0) templates.push(template)
    else templates[index] = template
  }
  const labels = [...incoming.labels]
  for (const label of existing?.labels ?? []) {
    if (!retainedRows.some((row) => row.label.split(',').map(imageStem).includes(imageStem(label.name)))) continue
    const index = labels.findIndex((item) => imageStem(item.name) === imageStem(label.name))
    if (index < 0) labels.push(label)
    else labels[index] = label
  }
  if (templates.length > 6 || labels.length > 100) throw new Error('진행 중인 등록 파일을 보존하려면 작업을 나눠 저장해주세요. 견적서 6개, 품질표시 100개까지 사용할 수 있습니다.')
  return { ...incoming, rounding: retainedRows.length ? existing?.rounding ?? incoming.rounding : incoming.rounding, rows, templates, labels }
}
