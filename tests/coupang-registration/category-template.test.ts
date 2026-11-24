// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ workspace: vi.fn() }))
vi.mock('@/lib/coupang-registration/auth', () => ({ registrationWorkspace: mocks.workspace }))
import { parseCategoryTemplate } from '@/lib/coupang-registration/category-template'
import { POST } from '@/app/api/operations/coupang-registration/category-template/route'

async function fixture(ids = ['123']) {
  const workbook = new ExcelJS.Workbook()
  for (const id of ids) {
    const sheet = workbook.addWorksheet(`QF_${id}_생활용품_옷걸이`)
    sheet.getRow(5).values = ['상품명', '공급가', '브랜드']
    sheet.getRow(6).values = ['필수', '필수', '필수']
    sheet.getRow(9).values = ['추가하면 안 되는 샘플 상품', 1000, '생활살림']
  }
  workbook.addWorksheet('HQF_6_123', { state: 'veryHidden' }).getCell('A1').value = '공식 메타데이터'
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
const saved = (buffer: Buffer, name = '공식 견적서.xlsx') => ({ name, data: buffer.toString('base64') })
const request = (body: unknown) => new NextRequest('https://app.test/api/category-template', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
beforeEach(() => { vi.clearAllMocks(); mocks.workspace.mockResolvedValue('workspace-owner') })

describe('selected official category template import', () => {
  it('extracts the only official workbook from ZIP and preserves its bytes while omitting sample products', async () => {
    const workbook = await fixture()
    const zip = new JSZip().file('카테고리 견적서.xlsx', workbook).file('안내.txt', '안내')
    const template = await parseCategoryTemplate('123', saved(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), '카테고리 견적서.zip'))
    expect(template.id).toBe(createHash('sha256').update(workbook).digest('hex'))
    expect(template.file).toEqual(saved(workbook, '카테고리 견적서.xlsx'))
    expect(template.sheets.map((sheet) => sheet.name)).toEqual(['QF_123_생활용품_옷걸이'])
    expect(template).not.toHaveProperty('rows')
  })

  it('accepts XLSX directly and rejects category prefixes, mixed category files, and invalid IDs', async () => {
    const file = saved(await fixture())
    expect((await parseCategoryTemplate('123', file)).sheets).toHaveLength(1)
    await expect(parseCategoryTemplate('12', file)).rejects.toThrow('일치')
    await expect(parseCategoryTemplate('123', saved(await fixture(['123', '1234'])))).rejects.toThrow('일치')
    for (const id of ['0', '0123', '-1', '1e3']) await expect(parseCategoryTemplate(id, file)).rejects.toThrow('ID')
  })

  it('rejects multiple XLSX entries including duplicate central-directory names', async () => {
    const workbook = await fixture()
    const zip = new JSZip().file('one.xlsx', workbook).file('two.xlsx', workbook)
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(parseCategoryTemplate('123', saved(buffer, '여러 양식.zip'))).rejects.toThrow('1개')
    const duplicate = Buffer.from(buffer)
    for (let offset = 0; offset <= duplicate.length - 8; offset++) if (duplicate.toString('ascii', offset, offset + 8) === 'two.xlsx') duplicate.write('one.xlsx', offset, 'ascii')
    await expect(parseCategoryTemplate('123', saved(duplicate, '중복 양식.zip'))).rejects.toThrow('1개')
  })

  it('enforces compressed and uncompressed bounds and safe file names before workbook parsing', async () => {
    const file = saved(await fixture())
    await expect(parseCategoryTemplate('123', { ...file, name: '../견적서.xlsx' })).rejects.toThrow('파일명')
    await expect(parseCategoryTemplate('123', saved(Buffer.alloc(3_000_001), '큰 파일.xlsx'))).rejects.toThrow('3MB')
    const zip = new JSZip().file('커다란 견적서.xlsx', Buffer.alloc(3_000_001))
    const smallZip = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    expect(smallZip.length).toBeLessThan(100_000)
    await expect(parseCategoryTemplate('123', saved(smallZip, '압축 폭탄.zip'))).rejects.toThrow('3MB')
    const misleadingSize = Buffer.from(smallZip)
    const directory = misleadingSize.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    misleadingSize.writeUInt32LE(1, directory + 24)
    await expect(parseCategoryTemplate('123', saved(misleadingSize, '허위 크기.zip'))).rejects.toThrow('3MB')
    await expect(parseCategoryTemplate('123', { ...file, data: file.data.slice(1) })).rejects.toThrow()
  })

  it('requires workspace authorization and returns only the verified template with private no-store caching', async () => {
    const body = { categoryId: '123', file: saved(await fixture()) }
    mocks.workspace.mockResolvedValue(null)
    expect((await POST(request(body))).status).toBe(403)
    mocks.workspace.mockResolvedValue('workspace-owner')
    const response = await POST(request(body))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const result = await response.json()
    expect(Object.keys(result)).toEqual(['template'])
    expect(result.template).not.toHaveProperty('rows')
    expect((await POST(request({ ...body, categoryId: '12' }))).status).toBe(400)
    expect((await POST(request({ ...body, file: { ...body.file, data: 'A'.repeat(4_000_001) } }))).status).toBe(400)
  })
})
