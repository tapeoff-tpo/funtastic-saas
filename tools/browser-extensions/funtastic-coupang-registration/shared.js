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
  function publicImageUrl(value) {
    try {
      const url = new URL(value)
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      if (url.protocol !== 'https:' || url.username || url.password || value.length > 4000) return false
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.includes(':')) return false
      if (/^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return false
      return /\.(?:jpe?g|png)(?:$|[?#])/i.test(url.pathname + url.search)
    } catch { return false }
  }
  function validateIndividualJob(job) {
    if (!job || !clean(job.jobId) || typeof job.jobId !== 'string' || job.jobId.length > 200 || typeof job.token !== 'string' || job.token.length < 16 || job.token.length > 300) throw new Error('등록 작업 식별값을 확인해주세요.')
    if (!Array.isArray(job.products) || !job.products.length || job.products.length > 20) throw new Error('개별등록은 한 번에 20개 상품까지 준비할 수 있습니다.')
    const ids = new Set(), names = new Set()
    const products = job.products.map(product => {
      if (!product || typeof product !== 'object') throw new Error('개별등록 상품 정보를 확인해주세요.')
      const strings = {}
      for (const key of ['id', 'name', 'sourceCode', 'modelName', 'brand', 'color', 'quantity', 'barcode', 'manufacturer', 'importer', 'tradeType', 'taxType', 'importType', 'size', 'alternativeText']) {
        if (typeof product[key] !== 'string' || product[key].length > (key === 'id' || key === 'sourceCode' ? 100 : 1000)) throw new Error('개별등록 상품 입력값을 확인해주세요.')
        strings[key] = clean(product[key])
      }
      if (!strings.id || !strings.name || !strings.brand || !strings.modelName || !strings.color || !strings.quantity || !strings.manufacturer || ids.has(strings.id) || names.has(strings.name)) throw new Error('상품명·옵션·브랜드와 중복 상품을 확인해주세요.')
      ids.add(strings.id); names.add(strings.name)
      if (![product.supplyPrice, product.sellingPrice].every(value => Number.isFinite(value) && value > 0 && value <= 1_000_000_000) || product.sellingPrice < product.supplyPrice || typeof product.coupangBarcode !== 'boolean') throw new Error('개별등록 가격·바코드를 확인해주세요.')
      if (!publicImageUrl(product.primaryImageUrl) || !Array.isArray(product.additionalImageUrls) || product.additionalImageUrls.length > 9 || product.additionalImageUrls.some(value => typeof value !== 'string' || !publicImageUrl(value))) throw new Error('상품 이미지 주소를 확인해주세요.')
      if (typeof product.detailHtml !== 'string' || !product.detailHtml || product.detailHtml.length > 100_000 || /<\s*(?:script|iframe|object|embed|form|input|link|style|svg|math)\b|\bon\w+\s*=|javascript:|data:/i.test(product.detailHtml)) throw new Error('상품 상세 컨텐츠를 확인해주세요.')
      if (!Array.isArray(product.tags) || product.tags.length > 30 || product.tags.some(value => typeof value !== 'string' || value.length > 200)) throw new Error('검색태그를 확인해주세요.')
      const category = product.category
      if (!category || typeof category.sourcePath !== 'string' || category.sourcePath.length > 1000 || typeof category.sourceName !== 'string' || category.sourceName.length > 500 || !Array.isArray(category.searchTerms) || category.searchTerms.length > 6 || category.searchTerms.some(value => typeof value !== 'string' || value.length > 500) || category.hubPath !== undefined && (typeof category.hubPath !== 'string' || category.hubPath.length > 1000)) throw new Error('상품 카테고리 검색 정보를 확인해주세요.')
      if (!Array.isArray(product.labelFiles) || product.labelFiles.length > 4 || !Array.isArray(product.labelImageUrls) || product.labelImageUrls.length > 4 || product.labelImageUrls.some(value => typeof value !== 'string' || !publicImageUrl(value)) || !product.labelFiles.length && !product.labelImageUrls.length) throw new Error('품질표시 JPG·PNG를 준비해주세요.')
      let labelSize = 0
      const labelNames = new Set()
      for (const file of product.labelFiles) {
        if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 250 || /[\\/]/.test(file.name) || !/\.(?:jpe?g|png)$/i.test(file.name) || labelNames.has(clean(file.name)) || typeof file.data !== 'string' || !file.data || file.data.length > 2_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error('품질표시 파일 정보를 확인해주세요.')
        labelNames.add(clean(file.name)); labelSize += file.data.length
      }
      if (labelSize > 3_200_000) throw new Error('품질표시 파일 용량을 줄여주세요.')
      const logistics = product.logistics
      if (!logistics || !Number.isSafeInteger(logistics.boxQuantity) || logistics.boxQuantity < 1 || logistics.boxQuantity > 1_000_000 || !Number.isSafeInteger(logistics.shelfLifeDays) || logistics.shelfLifeDays < 0 || logistics.shelfLifeDays > 1_000_000 || !Number.isFinite(logistics.weightGrams) || logistics.weightGrams <= 0 || logistics.weightGrams > 1_000_000 || typeof logistics.handlingReason !== 'string' || logistics.handlingReason.length > 500 || !Array.isArray(logistics.dimensionsMm) || logistics.dimensionsMm.length !== 3 || logistics.dimensionsMm.some(value => !Number.isFinite(value) || value <= 0 || value > 100_000)) throw new Error('포장 치수·무게와 물류 정보를 확인해주세요.')
      const records = {}
      for (const key of ['certifications', 'notices']) {
        const value = product[key]
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 30 || Object.entries(value).some(([name, text]) => name.length > 500 || typeof text !== 'string' || text.length > 4000)) throw new Error('상품 고시·인증 정보를 확인해주세요.')
        records[key] = { ...value }
      }
      return { ...strings, ...records, supplyPrice: product.supplyPrice, sellingPrice: product.sellingPrice, coupangBarcode: product.coupangBarcode, primaryImageUrl: product.primaryImageUrl, additionalImageUrls: [...product.additionalImageUrls], detailHtml: product.detailHtml, tags: [...product.tags], category: { ...category, searchTerms: [...category.searchTerms] }, labelFiles: product.labelFiles.map(file => ({ name: file.name, data: file.data })), labelImageUrls: [...product.labelImageUrls], logistics: { ...logistics, dimensionsMm: [...logistics.dimensionsMm] } }
    })
    const result = { mode: 'individual', jobId: job.jobId, token: job.token, products }
    if (JSON.stringify(result).length > 4_000_000) throw new Error('개별등록 작업 용량이 큽니다. 상품을 나눠주세요.')
    return result
  }
  function validateJob(job) {
    if (job?.mode === 'individual') return validateIndividualJob(job)
    if (job?.mode !== undefined && job.mode !== 'excel') throw new Error('쿠팡 등록 방식을 확인해주세요.')
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
  scope.FuntasticSupplierRules = { clean, headerText, fullQuoteId, quoteIdentity, allowedSaas, validateJob, validateIndividualJob, publicImageUrl, quoteResult, productResult }
})(globalThis)
