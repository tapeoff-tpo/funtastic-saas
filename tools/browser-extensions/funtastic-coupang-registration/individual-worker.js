;(function (scope) {
  const HUB = 'https://supplier.coupang.com/sr/registration'
  const terminal = status => ['prepared', 'cancelled', 'succeeded', 'failed'].includes(status)
  const steps = new Set(['basic', 'product', 'image', 'legal', 'logistics'])
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
  const progress = item => item.products.map(({ id, name, status, step, message, checkpoint }) => ({ id, name, status, step, message,
    ...(checkpoint?.draftName ? { draftName: checkpoint.draftName } : {}), ...(checkpoint?.draftSavedAt ? { draftSavedAt: checkpoint.draftSavedAt } : {}) }))

  function create({ jobs, persist, report, channel }) {
    const requireItem = (all, reference) => {
      const item = reference && all[reference.jobId]
      if (!item || item.job?.mode !== 'individual' || item.job.token !== reference.token) throw new Error('이 Chrome에 저장된 개별등록 작업을 확인할 수 없습니다.')
      return item
    }
    async function publish(item) {
      const products = progress(item)
      const count = products.filter(product => product.status === 'prepared').length
      const status = item.cancelled ? 'cancelled' : count === products.length ? 'prepared'
        : products.some(product => product.status === 'login_required') ? 'login_required'
          : products.some(product => ['attention_required', 'failed'].includes(product.status)) ? 'attention_required' : 'running'
      const current = products.find(product => !['prepared', 'cancelled'].includes(product.status))
      const message = status === 'prepared' ? `${count}개 상품의 입력·중간 저장이 완료됐습니다. 쿠팡에서 최종 등록을 확인해주세요.`
        : status === 'cancelled' ? '개별등록 자동 입력을 중지했습니다. 쿠팡에 저장된 초안은 유지됩니다.'
          : current?.message || `개별등록 준비 중 (${count}/${products.length})`
      await report(item, status, message, { products })
    }
    async function dispatch(item, reason = 'automatic') {
      if (item.cancelled || item.lastProgress?.status === 'prepared') return
      const entry = item.products.find(product => !['prepared', 'cancelled'].includes(product.status))
      if (!entry) { await publish(item); await persist(await merge(item)); return }
      if (['attention_required', 'failed'].includes(entry.status) && reason !== 'resume') return
      let tab = entry.tabId && await chrome.tabs.get(entry.tabId).catch(() => null)
      if (!tab) {
        if (entry.status !== 'queued' && reason !== 'resume') {
          entry.status = 'attention_required'; entry.message = '쿠팡 작업 탭이 닫혔습니다. 다시 확인을 눌러 저장한 초안을 복원해주세요.'
          await publish(item); await persist(await merge(item)); return
        }
        entry.status = 'running'; entry.message = '비활성 쿠팡 탭을 여는 중입니다.'
        await persist(await merge(item))
        tab = await chrome.tabs.create({ url: HUB, active: false })
        if (!Number.isInteger(tab.id)) throw new Error('쿠팡 작업 탭을 열지 못했습니다.')
        entry.tabId = tab.id
        await persist(await merge(item))
      }
      if (tab.status !== 'complete') return
      let url
      try { url = new URL(tab.url) } catch { url = null }
      if (!url || url.origin !== 'https://supplier.coupang.com' || /\/(?:login|signin|auth)(?:\/|$)/i.test(url.pathname)) {
        entry.status = 'login_required'; entry.message = '쿠팡 화면 열기를 눌러 로그인한 뒤 다시 확인해주세요.'
        await publish(item); await persist(await merge(item)); return
      }
      if (!/^\/sr\/registration(?:\/|$)/.test(url.pathname)) {
        entry.status = 'attention_required'; entry.message = '쿠팡 개별등록 화면이 아닙니다. 작업 탭을 확인해주세요.'
        await publish(item); await persist(await merge(item)); return
      }
      entry.status = 'running'; entry.message = '쿠팡 탭 안에서 상품정보를 입력하고 있습니다.'
      await publish(item)
      await persist(await merge(item))
      // The content script reports phases back to this serialized worker.
      // Never await its completion here or those callbacks would deadlock.
      void chrome.tabs.sendMessage(entry.tabId, { channel, type: 'INDIVIDUAL_PREPARE', job: item.job,
        productIndex: item.products.indexOf(entry), checkpoint: entry.checkpoint }).catch(async () => {
        // An extension reload can leave an old page without a receiver. Do not
        // reload or replace a form whose writes may already have started.
        const all = await jobs(), current = all[item.job.jobId]
        if (!current || current.cancelled) return
        const product = current.products.find(product => product.id === entry.id)
        if (!product || product.status === 'prepared') return
        product.status = 'attention_required'; product.message = '쿠팡 탭에 확장이 연결되지 않았습니다. 해당 탭에서 확장 연결을 확인해주세요.'
        await publish(current); await persist(all)
      })
    }
    async function merge(item) { const all = await jobs(); all[item.job.jobId] = item; return all }
    async function open(job, sender, checkOnly) {
      const all = await jobs()
      let item = all[job.jobId]
      if (item && canonical(item.job) !== canonical(job)) throw new Error('이미 시작한 개별등록 상품정보가 변경됐습니다. 기존 작업을 확인해주세요.')
      if (!item) {
        if (checkOnly) throw new Error('처음 개별등록을 시작한 Chrome에서 확인해주세요.')
        if (Object.values(all).some(value => !terminal(value.lastProgress?.status))) throw new Error('진행 중인 쿠팡 등록 작업을 먼저 확인해주세요.')
        item = { job, sourceTabId: sender.tab.id, phase: 'individual', createdAt: new Date().toISOString(),
          products: job.products.map(product => ({ id: product.id, name: product.name, status: 'queued', step: 'basic', message: '입력 대기' })) }
        all[job.jobId] = item
      }
      item.sourceTabId = sender.tab.id
      await publish(item); await persist(all)
      await chrome.alarms.create('supplier-registration-check', { periodInMinutes: 1 })
      if (!terminal(item.lastProgress?.status)) await dispatch(item, checkOnly ? 'resume' : 'start')
      return { ok: true, started: true }
    }
    async function control(type, reference, sender, productId) {
      const all = await jobs(), item = requireItem(all, reference)
      item.sourceTabId = sender.tab.id
      if (type === 'STOP_JOB') {
        item.cancelled = true
        for (const entry of item.products) if (entry.status !== 'prepared') entry.status = 'cancelled'
        await publish(item); await persist(all)
        for (const entry of item.products) if (entry.tabId) void chrome.tabs.sendMessage(entry.tabId,
          { channel, type: 'INDIVIDUAL_STOP', jobId: item.job.jobId, token: item.job.token, productId: entry.id }).catch(() => {})
      } else if (type === 'OPEN_JOB') {
        const entry = productId ? item.products.find(entry => entry.id === productId)
          : item.products.find(entry => !['prepared', 'cancelled'].includes(entry.status)) || item.products.at(-1)
        const tab = entry?.tabId && await chrome.tabs.get(entry.tabId).catch(() => null)
        if (!tab) throw new Error('쿠팡 작업 탭이 닫혔습니다. 다시 확인으로 저장된 초안을 복원해주세요.')
        await chrome.tabs.update(tab.id, { active: true })
        await publish(item); await persist(all)
      } else {
        await publish(item); await persist(all)
        if (type === 'RESUME_JOB' && !item.cancelled) await dispatch(item, 'resume')
      }
      return { ok: true, started: true }
    }
    async function fromSupplier(message, sender) {
      const all = await jobs(), item = requireItem(all, message)
      const entry = item.products.find(entry => entry.id === message.productId)
      let senderOrigin
      try { senderOrigin = new URL(sender.url).origin } catch { senderOrigin = '' }
      if (!entry || entry.tabId !== sender.tab?.id || senderOrigin !== 'https://supplier.coupang.com') throw new Error('개별등록 상품과 쿠팡 탭이 일치하지 않습니다.')
      if (item.cancelled || entry.status === 'prepared') return { ok: true }
      if (!steps.has(message.step) || !['running', 'login_required', 'attention_required', 'prepared', 'failed'].includes(message.phase) || typeof message.message !== 'string' || message.message.length > 2000) throw new Error('개별등록 진행 상태를 확인해주세요.')
      if (message.checkpoint !== undefined && (!message.checkpoint || typeof message.checkpoint !== 'object' || JSON.stringify(message.checkpoint).length > 20_000)) throw new Error('개별등록 저장 위치 정보를 확인해주세요.')
      if (message.stepStatus === 'saved' && (message.draftName !== entry.name || typeof message.draftSavedAt !== 'string' || !message.draftSavedAt || message.draftSavedAt.length > 100 || !message.assets || typeof message.assets !== 'object' || Array.isArray(message.assets) || JSON.stringify(message.assets).length > 20_000)) throw new Error('상품명과 쿠팡 중간 저장 확인이 필요합니다.')
      if (message.phase === 'prepared' && (message.draftName !== entry.name || typeof message.draftSavedAt !== 'string' || !message.draftSavedAt || message.draftSavedAt.length > 100)) throw new Error('상품명과 쿠팡 중간 저장 확인이 필요합니다.')
      entry.status = message.phase; entry.step = message.step; entry.message = message.message
      if (message.checkpoint) entry.checkpoint = { ...entry.checkpoint, ...message.checkpoint }
      if (message.stepStatus === 'saved') entry.checkpoint = { ...entry.checkpoint, step: message.step, assets: message.assets }
      if (message.draftName || message.draftSavedAt) entry.checkpoint = { ...entry.checkpoint,
        ...(message.draftName ? { draftName: message.draftName } : {}), ...(message.draftSavedAt ? { draftSavedAt: message.draftSavedAt } : {}) }
      await publish(item); await persist(all)
      if (message.phase === 'prepared') await dispatch(item, 'next')
      return { ok: true }
    }
    return { open, control, fromSupplier, dispatch, ownsTab: (item, tabId) => item.products?.some(entry => entry.tabId === tabId) }
  }
  scope.FuntasticIndividualWorker = { create }
})(globalThis)
