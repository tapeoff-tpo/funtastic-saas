import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const directory = path.resolve('tools/browser-extensions/funtastic-coupang-registration')
const shared = readFileSync(path.join(directory, 'shared.js'), 'utf8')
const source = readFileSync(path.join(directory, 'background.js'), 'utf8')
const context: Record<string, unknown> = { URL }
vm.runInNewContext(shared, context)
type RuleResult = { state: string; quoteId?: string; products?: unknown[]; message?: string }
const rules = context.FuntasticSupplierRules as { allowedSaas: (url: string) => boolean; validateJob: (job: unknown) => unknown; quoteResult: (rows: unknown[], name: string) => RuleResult; productResult: (rows: unknown[], names: string[], quote: string) => RuleResult }
const job = { jobId: 'job-123', token: '0123456789abcdef', rows: [{ id: 'r1', name: '상품 빨강' }, { id: 'r2', name: '상품 파랑' }], files: [{ name: 'job-123.xlsx', data: 'UEs=', kind: 'workbook' }] }

describe('Supplier extension identity and completion rules', () => {
  it('limits SaaS command origins and paths and manifest permissions', () => {
    expect(rules.allowedSaas('https://funtastic-saas-vercel.vercel.app/operations/coupang-registration')).toBe(true)
    for (const url of ['https://evil.test/operations/coupang-registration', 'https://funtastic-saas-vercel.vercel.app.evil.test/operations/coupang-registration', 'https://funtastic-saas-vercel.vercel.app/orders', 'https://supplier.coupang.com/qvt/registration']) expect(rules.allowedSaas(url)).toBe(false)
    const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
    expect(manifest.permissions).not.toContain('cookies')
    expect(manifest.permissions).not.toContain('debugger')
    expect(manifest.host_permissions).toEqual(['https://supplier.coupang.com/*', 'https://funtastic-saas-vercel.vercel.app/*', 'http://localhost:3000/*', 'http://localhost:3001/*'])
  })
  it('rejects duplicate names, multiple workbooks, and invalid attachment paths', () => {
    expect(() => rules.validateJob(job)).not.toThrow()
    expect(() => rules.validateJob({ ...job, rows: [job.rows[0], { id: 'r2', name: job.rows[0].name }] })).toThrow()
    expect(() => rules.validateJob({ ...job, files: [...job.files, { ...job.files[0], name: 'second.xlsx' }] })).toThrow()
    expect(() => rules.validateJob({ ...job, files: [{ ...job.files[0], name: '../work.xlsx' }] })).toThrow()
  })
  it('binds a quote only to one exact unique workbook filename', () => {
    expect(rules.quoteResult([{ workbookName: 'other.xlsx', status: '검증 완료', quoteId: '77' }], 'job-123.xlsx').state).toBe('pending')
    const quote = { workbookName: 'job-123.xlsx', status: '검증 완료', result: '성공', quoteId: '77' }
    expect(rules.quoteResult([quote], 'job-123.xlsx')).toMatchObject({ state: 'verified', quoteId: '77' })
    expect(rules.quoteResult([quote, quote], 'job-123.xlsx').state).toBe('pending')
    expect(rules.quoteResult([{ ...quote, quoteId: '-' }], 'job-123.xlsx').state).toBe('pending')
    expect(rules.quoteResult([{ ...quote, result: '오류' }], 'job-123.xlsx').state).toBe('pending')
    expect(rules.quoteResult([{ ...quote, status: '검증 실패', result: '파일 오류' }], 'job-123.xlsx').state).toBe('failed')
    expect(rules.quoteResult([{ ...quote, status: '검증 진행중', result: '오류 없음' }], 'job-123.xlsx').state).toBe('pending')
    expect(rules.quoteResult([{ ...quote, result: '오류 없음' }], 'job-123.xlsx').state).toBe('verified')
    expect(rules.quoteResult([{ ...quote, result: '성공: 오류 0건' }], 'job-123.xlsx').state).toBe('verified')
    expect(rules.quoteResult([{ ...quote, quoteId: '766f7621... ( 2897425 )' }], 'job-123.xlsx').state).toBe('pending')
    expect(rules.quoteResult([{ ...quote, quoteId: '766f7621… ( 2897425 )', quoteAttributes: ['766f7621-1234-5678-abcd-1234567890ab'] }], 'job-123.xlsx')).toMatchObject({ state: 'verified', quoteId: '766f7621-1234-5678-abcd-1234567890ab' })
  })
  it('requires every exact name, quote, final status, and unique SKU before success', () => {
    const products = [{ name: '상품 빨강', quoteId: '77', skuId: '1001', status: '상품 검수 완료' }, { name: '상품 파랑', quoteId: '77', skuId: '1002', status: '상품 검수 완료' }]
    const check = (rows: unknown[]) => rules.productResult(rows, ['상품 빨강', '상품 파랑'], '77').state
    expect(check(products)).toBe('succeeded')
    expect(check(products.slice(0, 1))).toBe('pending')
    expect(check([...products, { ...products[0], name: '추가 상품' }])).toBe('pending')
    expect(check(products.map(row => ({ ...row, quoteId: 'other' })))).toBe('pending')
    expect(check([products[0], { ...products[1], skuId: '' }])).toBe('pending')
    expect(check([products[0], { ...products[1], skuId: '1001' }])).toBe('pending')
    expect(check([products[0], { ...products[1], status: '상품 검수중' }])).toBe('pending')
    expect(check([products[0], { ...products[1], status: '상품 검수 반려' }])).toBe('pending')
    expect(check(products.map(row => ({ ...row, status: '상품 검수 반려' })))).toBe('failed')
    expect(check([{ ...products[1], status: '상품 검수 반려' }])).toBe('pending')
    expect(check([{ ...products[0], status: '상품 검수중' }, { ...products[1], status: '상품 검수 반려' }])).toBe('pending')
    expect(check([products[0], { ...products[1], name: '비슷한 상품 파랑' }])).toBe('pending')
    expect(check(products.map(row => ({ ...row, quoteId: '77… (12345)' })))).toBe('pending')
  })
})

describe('Supplier extension worker handoff', () => {
  function worker() {
    let listener: (message: unknown, sender: unknown, respond: (value: unknown) => void) => void = () => {}
    let store: Record<string, unknown> = {}
    const chrome = {
      storage: { local: { get: vi.fn(async () => store), set: vi.fn(async value => { store = structuredClone(value) }) } },
      tabs: { create: vi.fn(async () => ({ id: 19 })), get: vi.fn(async () => ({ id: 19, url: 'https://supplier.coupang.com/qvt/registration', status: 'complete' })), update: vi.fn(async () => ({})), sendMessage: vi.fn(async (_id, message) => message.channel === 'funtastic-coupang-registration' ? new Promise(() => {}) : undefined), onUpdated: { addListener: vi.fn() } },
      alarms: { create: vi.fn(async () => {}), onAlarm: { addListener: vi.fn() } },
      runtime: { getManifest: () => ({ version: '1.0.0' }), onMessage: { addListener: (value: typeof listener) => { listener = value } } },
    }
    const sandbox: Record<string, unknown> = { chrome, URL, console, structuredClone, importScripts: () => {} }
    vm.runInNewContext(shared, sandbox)
    vm.runInNewContext(source, sandbox)
    return { chrome, send: (message: object, sender: object) => new Promise<unknown>(resolve => listener({ channel: 'funtastic-coupang-registration', ...message }, sender, resolve)) }
  }
  const sender = { tab: { id: 1 }, url: 'https://funtastic-saas-vercel.vercel.app/operations/coupang-registration' }
  it('does not deadlock START while content sends a separate preparation claim', async () => {
    const instance = worker()
    expect(await instance.send({ type: 'START', job }, sender)).toMatchObject({ ok: true, started: true })
    const supplier = { tab: { id: 19 }, url: 'https://supplier.coupang.com/qvt/registration' }
    expect(await instance.send({ type: 'CLAIM_PREPARATION', jobId: job.jobId, token: job.token }, supplier)).toEqual({ ok: true })
    expect(await instance.send({ type: 'CLAIM_PREPARATION', jobId: job.jobId, token: job.token }, supplier)).toMatchObject({ ok: false })
    expect(await instance.send({ type: 'CHECK', job: { ...job, receiptId: '77', status: 'running' } }, sender)).toMatchObject({ ok: true, started: true })
  })
  it('rejects commands from a foreign page and callbacks from a different supplier tab', async () => {
    const instance = worker()
    expect(await instance.send({ type: 'START', job }, { ...sender, url: 'https://evil.test/' })).toMatchObject({ ok: false })
    await instance.send({ type: 'START', job }, sender)
    expect(await instance.send({ type: 'STATE', jobId: job.jobId, token: job.token, status: 'succeeded' }, { tab: { id: 20 }, url: 'https://supplier.coupang.com/qvt/registration' })).toMatchObject({ ok: false })
  })
})
