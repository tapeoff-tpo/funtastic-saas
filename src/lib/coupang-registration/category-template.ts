import JSZip from 'jszip'
import type { Readable } from 'node:stream'
import { readTemplate } from './excel'
import type { SavedFile } from './model'

const MAX_FILE_BYTES = 3_000_000
const MAX_BASE64_LENGTH = 4_000_000
const MAX_WORKBOOK_EXPANSION = 60_000_000
const MAX_WORKBOOK_ENTRY = 20_000_000
const sizeError = () => new Error('카테고리 견적서는 압축 해제 후에도 3MB 이하여야 합니다.')

function safeFileName(name: string) {
  if (!name.trim() || name.length > 250 || /[\\/\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..') throw new Error('카테고리 견적서 파일명을 확인해주세요.')
  return name.normalize('NFC')
}

/** JSZip indexes by name, so inspect the directory first to catch duplicate XLSX names too. */
function zipDirectory(buffer: Buffer) {
  let end = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('지원하는 ZIP 견적서가 아닙니다.')
  const count = buffer.readUInt16LE(end + 10)
  const size = buffer.readUInt32LE(end + 12)
  let offset = buffer.readUInt32LE(end + 16)
  const boundary = offset + size
  if (!count || count > 2000 || count === 0xffff || size === 0xffffffff || offset === 0xffffffff || boundary > end || buffer.readUInt16LE(end + 8) !== count) throw new Error('ZIP 견적서 구성을 확인해주세요.')
  const entries: Array<{ name: string; size: number; directory: boolean }> = []
  for (let index = 0; index < count; index++) {
    if (offset + 46 > boundary || buffer.readUInt32LE(offset) !== 0x02014b50 || buffer.readUInt16LE(offset + 8) & 1) throw new Error('ZIP 견적서 구성을 확인해주세요.')
    const nameLength = buffer.readUInt16LE(offset + 28)
    const next = offset + 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    if (next > boundary || uncompressedSize === 0xffffffff) throw new Error('ZIP 견적서 구성을 확인해주세요.')
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.push({ name, size: uncompressedSize, directory: name.endsWith('/') })
    offset = next
  }
  if (offset !== boundary) throw new Error('ZIP 견적서 구성을 확인해주세요.')
  return entries
}

async function boundedEntry(entry: JSZip.JSZipObject, maximum: number, collect = true): Promise<Buffer> {
  const declared = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  if (!Number.isSafeInteger(declared) || declared! < 0 || declared! > maximum) throw sizeError()
  let size = 0
  const chunks: Buffer[] = []
  const stream = entry.nodeStream('nodebuffer') as Readable
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      stream.pause()
      stream.destroy?.()
      reject(error)
    }
    stream.on('error', fail)
    stream.on('data', (chunk) => {
      if (settled) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maximum) { fail(sizeError()); return }
      if (collect) chunks.push(bytes)
    })
    stream.on('end', () => {
      if (settled) return
      if (size !== declared) { fail(new Error('카테고리 견적서의 압축 크기가 일치하지 않습니다.')); return }
      settled = true
      resolve(collect ? Buffer.concat(chunks, size) : Buffer.alloc(0))
    })
  })
}

async function verifyWorkbookExpansion(buffer: Buffer) {
  const entries = zipDirectory(buffer).filter((entry) => !entry.directory)
  if (entries.some((entry) => entry.size > MAX_WORKBOOK_ENTRY) || entries.reduce((total, entry) => total + entry.size, 0) > MAX_WORKBOOK_EXPANSION) throw new Error('카테고리 견적서 내부 데이터 크기가 지원 범위를 초과했습니다.')
  const workbook = await JSZip.loadAsync(buffer)
  for (const entry of Object.values(workbook.files).filter((entry) => !entry.dir)) await boundedEntry(entry, MAX_WORKBOOK_ENTRY, false)
}

export async function parseCategoryTemplate(categoryId: string, file: SavedFile) {
  if (!/^[1-9]\d{0,99}$/.test(categoryId)) throw new Error('쿠팡 카테고리 ID를 확인해주세요.')
  const name = safeFileName(file.name)
  if (!/\.(xlsx|zip)$/i.test(name) || !file.data || file.data.length > MAX_BASE64_LENGTH || file.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) throw new Error('3MB 이하의 쿠팡 견적서 ZIP 또는 XLSX 파일을 선택해주세요.')
  let buffer: Buffer = Buffer.from(file.data, 'base64')
  if (!buffer.length || buffer.length > MAX_FILE_BYTES || buffer.toString('base64') !== file.data) throw sizeError()
  let workbookName = name
  if (/\.zip$/i.test(name)) {
    const entries = zipDirectory(buffer).filter((entry) => !entry.directory && /\.xlsx$/i.test(entry.name))
    if (entries.length !== 1) throw new Error('선택한 카테고리의 XLSX 견적서 1개만 포함된 ZIP을 사용해주세요.')
    if (entries[0].size > MAX_FILE_BYTES) throw sizeError()
    const zip = await JSZip.loadAsync(buffer)
    const workbooks = Object.values(zip.files).filter((entry) => !entry.dir && /\.xlsx$/i.test(entry.name))
    if (workbooks.length !== 1) throw new Error('ZIP 안의 카테고리 견적서를 확인하지 못했습니다.')
    workbookName = safeFileName(workbooks[0].name.split(/[\\/]/).at(-1) ?? '')
    buffer = await boundedEntry(workbooks[0], MAX_FILE_BYTES)
  }
  await verifyWorkbookExpansion(buffer)
  const { template } = await readTemplate(buffer, workbookName)
  if (!template.sheets.length || template.sheets.some((sheet) => !sheet.name.startsWith(`QF_${categoryId}_`))) throw new Error('다운로드한 견적서 카테고리가 선택한 쿠팡 카테고리와 일치하지 않습니다.')
  return template
}
