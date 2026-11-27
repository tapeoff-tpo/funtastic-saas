import { calculatePrice, confirmPricing, confirmRegistration, getRegistrationStage, hasPreparedSupplierDraft, hasVerifiedSupplierRegistration, imageStem, isRegistrationDate, isRegistrationSubmissionActive, priceIssues, type RegistrationDraft } from './model'

type DraftSaveOptions = { deleteCompletedRowIds?: readonly string[] }

/** Browser saves may edit preparation, but may never manufacture a Hub receipt. */
export function prepareDraftSave(incoming: RegistrationDraft, existing?: RegistrationDraft, options: DraftSaveOptions = {}): RegistrationDraft {
  if (new Set(incoming.rows.map((row) => row.id)).size !== incoming.rows.length) throw new Error('같은 상품 행이 중복되었습니다. 작업을 다시 불러와주세요.')
  if (new Set(incoming.templates.map((template) => template.id)).size !== incoming.templates.length) throw new Error('견적서가 중복되었습니다. 작업을 다시 불러와주세요.')
  if (new Set(incoming.labels.map((label) => imageStem(label.name))).size !== incoming.labels.length) throw new Error('품질표시 파일명이 중복되었습니다.')
  const previous = new Map(existing?.rows.map((row) => [row.id, row]) ?? [])
  const inFlight = (row: RegistrationDraft['rows'][number]) => isRegistrationSubmissionActive(row) || row.submission?.status === 'login_required'
  const locked = (row: RegistrationDraft['rows'][number]) => getRegistrationStage(row) === 'registered' || hasVerifiedSupplierRegistration(row) || hasPreparedSupplierDraft(row) || inFlight(row)
  const deletedIds = new Set(options.deleteCompletedRowIds ?? [])
  if (deletedIds.size !== (options.deleteCompletedRowIds?.length ?? 0)) throw new Error('삭제할 상품 행이 중복되었습니다. 다시 선택해주세요.')
  if (deletedIds.size && !existing) throw new Error('저장된 등록완료 상품만 삭제할 수 있습니다.')
  for (const id of deletedIds) {
    const old = previous.get(id)
    if (!old) throw new Error('삭제할 등록완료 상품을 찾을 수 없습니다. 최신 작업을 다시 불러와주세요.')
    if (inFlight(old) || hasVerifiedSupplierRegistration(old) || hasPreparedSupplierDraft(old)) throw new Error('진행 중이거나 쿠팡 등록 결과가 있는 상품은 삭제할 수 없습니다.')
    if (getRegistrationStage(old) !== 'registered') throw new Error('등록완료 상품만 삭제할 수 있습니다.')
  }
  const rows = incoming.rows.filter((row) => !deletedIds.has(row.id)).map((row) => {
    const old = previous.get(row.id)
    if (old && inFlight(old)) return old
    const { submission: _submission, registeredAt: _registeredAt, ...editable } = row
    void _submission; void _registeredAt
    const completionDate = row.registrationCompletedAt
    if (completionDate && (row.stage !== 'registered' || !isRegistrationDate(completionDate))) throw new Error('등록완료 날짜를 확인해주세요.')
    if (old && hasVerifiedSupplierRegistration(old) && !completionDate && row.stage !== 'information') return old
    if (old && getRegistrationStage(old) === 'registered' && row.stage === 'pricing') throw new Error('등록완료 체크를 해제한 뒤 가격을 수정해주세요.')
    if (old && hasPreparedSupplierDraft(old) && row.stage === 'pricing') throw new Error('쿠팡에 중간 저장된 상품은 판매가설정으로 되돌릴 수 없습니다.')
    const oldProtected = !!old && (getRegistrationStage(old) === 'registered' || hasVerifiedSupplierRegistration(old) || hasPreparedSupplierDraft(old))
    const source: RegistrationDraft['rows'][number] = oldProtected && old ? old : { ...editable, addedAt: old?.addedAt ?? row.addedAt }
    if (row.stage === 'information' || completionDate || old && hasVerifiedSupplierRegistration(old)) {
      const issues = priceIssues(row, incoming.rounding)
      if (issues.length) throw new Error(`${row.name}: ${issues.join(' ')}`)
      let prepared: RegistrationDraft['rows'][number]
      if (old && getRegistrationStage(old) !== 'pricing') {
        const previousPrices = calculatePrice(old, existing!.rounding)
        const incomingPrices = calculatePrice(row, incoming.rounding)
        if (incomingPrices.supply !== previousPrices.supply || incomingPrices.sale !== previousPrices.sale) throw new Error(`${row.name}: 가격을 변경하려면 판매가설정으로 되돌려주세요.`)
        prepared = {
          ...source, stage: 'information' as const, priceConfirmedAt: old.priceConfirmedAt ?? new Date().toISOString(), registrationCompletedAt: undefined,
          priceMode: 'manual' as const, manualSupplyPrice: previousPrices.supply, saleMode: 'manual' as const, manualSalePrice: previousPrices.sale,
          submission: old.submission, registeredAt: old.registeredAt,
        }
      } else {
        if (completionDate && (old && getRegistrationStage(old) === 'pricing' || !row.priceConfirmedAt)) throw new Error('판매가설정을 먼저 완료해주세요.')
        prepared = confirmPricing({ ...source, stage: 'pricing', priceConfirmedAt: undefined, registrationCompletedAt: undefined }, incoming.rounding)
      }
      return completionDate ? confirmRegistration(prepared, completionDate) : prepared
    }
    return { ...source, stage: 'pricing' as const, priceConfirmedAt: undefined, registrationCompletedAt: undefined }
  })
  for (const old of previous.values()) {
    if (!deletedIds.has(old.id) && locked(old) && !rows.some((row) => row.id === old.id)) rows.push(old)
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
