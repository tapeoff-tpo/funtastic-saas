/* Browser-independent parsing rules, shared by the worker and observed DOM adapter. */
;(function (scope) {
  const clean = value => String(value ?? '').normalize('NFC').trim()
  const headerText = value => clean(value).replace(/\s+/g, ' ').replace(/\s*\?$/, '').trim()
  const fullQuoteId = value => {
    const candidate = clean(value)
    if (!candidate || /\.{2,}|…/.test(candidate)) return ''
    const ids = candidate.match(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/ig)
    if (ids?.length === 1) return ids[0]
    return /^[a-zA-Z0-9_-]+$/.test(candidate) && candidate !== '-' ? candidate : ''
  }
  const quoteIdentity = (value, attributes = []) => {
    const identities = [...new Set([value, ...attributes].map(fullQuoteId).filter(Boolean))]
    return identities.length === 1 ? identities[0] : ''
  }
  const allowedSaas = url => {
    try {
      const value = new URL(url)
      return ['https://funtastic-saas-vercel.vercel.app', 'http://localhost:3000', 'http://localhost:3001'].includes(value.origin)
        && value.pathname === '/operations/coupang-registration'
    } catch { return false }
  }
  function validateJob(job) {
    if (!job || typeof job.jobId !== 'string' || !job.jobId || job.jobId.length > 200 || typeof job.token !== 'string' || job.token.length < 16 || job.token.length > 300) throw new Error('등록 작업 식별값을 확인해주세요.')
    if (!Array.isArray(job.rows) || !job.rows.length || job.rows.length > 500 || job.rows.some(row => !row || !clean(row.id) || !clean(row.name))) throw new Error('등록 상품 목록을 확인해주세요.')
    if (new Set(job.rows.map(row => clean(row.name))).size !== job.rows.length) throw new Error('결과를 정확히 연결할 수 있도록 등록 상품명을 서로 다르게 입력해주세요.')
    if (!Array.isArray(job.files) || job.files.length > 100 || job.files.filter(file => file.kind === 'workbook').length !== 1) throw new Error('한 번에 견적서 파일 1개씩 등록해주세요.')
    let size = 0
    const names = new Set()
    for (const file of job.files) {
      if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 250 || /[\\/]/.test(file.name) || names.has(clean(file.name))) throw new Error('중복되거나 잘못된 첨부파일명입니다.')
      if (!['workbook', 'label'].includes(file.kind) || typeof file.data !== 'string' || !file.data || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error('등록 첨부파일을 확인해주세요.')
      if (file.kind === 'workbook' ? !/\.xlsx$/i.test(file.name) : !/\.(jpe?g|png)$/i.test(file.name)) throw new Error('견적서는 XLSX, 품질표시는 JPG·PNG로 준비해주세요.')
      size += file.data.length
      names.add(clean(file.name))
    }
    if (size > 12_000_000) throw new Error('등록 파일 용량을 줄이거나 상품을 나눠주세요.')
    // Server status/receipt metadata may change while the actual submission stays
    // immutable. Compare only the original attachment and product snapshot.
    return { jobId: job.jobId, token: job.token, files: job.files.map(file => ({ name: file.name, data: file.data, kind: file.kind })), rows: job.rows.map(row => ({ id: row.id, name: row.name })) }
  }
  function quoteResult(rows, workbookName) {
    const matches = rows.filter(row => clean(row.workbookName) === clean(workbookName))
    if (matches.length !== 1) return { state: 'pending', message: matches.length ? '동일 견적서명이 여러 건입니다. 쿠팡 견적서 ID를 직접 확인해주세요.' : '아직 이 견적서의 검증 결과가 없습니다. 검증에는 최대 2시간이 걸릴 수 있습니다.' }
    const match = matches[0]
    const status = clean(match.status).replace(/\s+/g, '')
    if (['검증실패', '검증반려', '실패', '반려'].includes(status)) return { state: 'failed', message: `쿠팡 견적서 검증 결과: ${clean(match.status)} ${clean(match.result)}`.trim() }
    if (!['검증완료', '검증성공', '완료', '성공'].includes(status)) return { state: 'pending', message: '견적서 검증 중입니다. 완료 후 견적서 ID로 상품 검수 결과를 확인합니다.' }
    const result = clean(match.result).replace(/(?:오류|실패|반려)\s*(?:없음|없습니다|0\s*건)/g, '')
    if (/오류|실패|반려/.test(result)) return { state: 'pending', message: '견적서 검증 결과에 확인이 필요한 항목이 있습니다. 전체 반려가 확인되지 않아 재업로드하지 않습니다. 서플라이어허브에서 결과를 확인해주세요.' }
    const quoteId = quoteIdentity(match.quoteId, match.quoteAttributes || [])
    if (!quoteId) return { state: 'pending', message: '전체 견적서 ID를 확인하지 못했습니다. 축약된 ID만으로 완료 처리하지 않습니다. 서플라이어허브에서 전체 ID를 확인해주세요.' }
    return { state: 'verified', quoteId }
  }
  function productResult(rows, expectedNames, quoteId) {
    const matched = rows.filter(row => quoteIdentity(row.quoteId, row.quoteAttributes || []) === clean(quoteId))
    const exactRows = expectedNames.map(name => matched.filter(row => clean(row.name) === clean(name)))
    const allExact = matched.length === expectedNames.length && exactRows.every(matches => matches.length === 1)
    if (allExact && exactRows.every(matches => clean(matches[0].status) === '상품 검수 반려')) return { state: 'failed', message: '쿠팡에서 요청한 모든 상품의 검수를 반려했습니다. 서플라이어허브 상품 목록의 반려 사유를 확인해주세요.' }
    if (matched.some(row => expectedNames.includes(clean(row.name)) && clean(row.status) === '상품 검수 반려')) return { state: 'pending', message: '일부 상품이 반려됐습니다. 검수완료·검수중인 상품과 함께 재업로드하지 않도록 작업을 유지합니다. 서플라이어허브에서 반려 사유를 확인해주세요.' }
    const products = []
    for (const name of expectedNames) {
      const exact = matched.filter(row => clean(row.name) === clean(name))
      if (exact.length !== 1 || !/^[1-9]\d*$/.test(clean(exact[0].skuId)) || clean(exact[0].status) !== '상품 검수 완료') return { state: 'pending', message: '상품 검수가 진행 중이거나 전체 견적서 ID·상품·SKU 결과를 아직 정확히 확인하지 못했습니다.' }
      products.push({ name: clean(exact[0].name), skuId: clean(exact[0].skuId), status: clean(exact[0].status) })
    }
    if (matched.length !== expectedNames.length || new Set(products.map(product => product.skuId)).size !== products.length) return { state: 'pending', message: '견적서의 상품 수 또는 SKU가 등록 요청과 일치하지 않습니다. 서플라이어허브에서 확인해주세요.' }
    return { state: 'succeeded', products }
  }
  scope.FuntasticSupplierRules = { clean, headerText, fullQuoteId, quoteIdentity, allowedSaas, validateJob, quoteResult, productResult }
})(globalThis)
