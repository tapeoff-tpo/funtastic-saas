export const PURCHASING_RAW_BUNDLE_CONTENT_TYPE = 'application/vnd.funtastic.purchasing-raw+gzip'

const BUNDLE_VERSION = 1
const BUNDLE_HEADER_BYTES = 4
const MAX_MANIFEST_BYTES = 128 * 1024

export type PurchasingRawDataBundleFields = {
  mode: 'preview' | 'apply'
  asOfDate: string
  domesticInventoryReflectedThrough: string
  purchasePlanConfirmedSince: string
}

type BundleFileInput = {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

type BundleManifest = PurchasingRawDataBundleFields & {
  version: number
  files: Array<{ name: string; size: number }>
}

export async function packPurchasingRawDataBundle(
  fields: PurchasingRawDataBundleFields,
  files: readonly BundleFileInput[],
) {
  const fileBuffers = await Promise.all(files.map((file) => file.arrayBuffer()))
  const manifest: BundleManifest = {
    version: BUNDLE_VERSION,
    ...fields,
    files: files.map((file, index) => ({
      name: file.name,
      size: fileBuffers[index].byteLength,
    })),
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('업로드 파일 정보가 너무 큽니다.')
  }

  const payloadSize = fileBuffers.reduce((sum, buffer) => sum + buffer.byteLength, 0)
  const packed = new Uint8Array(BUNDLE_HEADER_BYTES + manifestBytes.byteLength + payloadSize)
  new DataView(packed.buffer).setUint32(0, manifestBytes.byteLength)
  packed.set(manifestBytes, BUNDLE_HEADER_BYTES)

  let offset = BUNDLE_HEADER_BYTES + manifestBytes.byteLength
  for (const buffer of fileBuffers) {
    const bytes = new Uint8Array(buffer)
    packed.set(bytes, offset)
    offset += bytes.byteLength
  }
  return packed
}

export function unpackPurchasingRawDataBundle(input: Uint8Array) {
  if (input.byteLength < BUNDLE_HEADER_BYTES) throw new Error('압축 업로드 헤더가 올바르지 않습니다.')

  const manifestSize = new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(0)
  if (manifestSize < 2 || manifestSize > MAX_MANIFEST_BYTES) {
    throw new Error('압축 업로드 파일 정보가 올바르지 않습니다.')
  }
  const dataOffset = BUNDLE_HEADER_BYTES + manifestSize
  if (dataOffset > input.byteLength) throw new Error('압축 업로드 데이터가 잘렸습니다.')

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(input.subarray(BUNDLE_HEADER_BYTES, dataOffset)))
  } catch {
    throw new Error('압축 업로드 파일 정보를 읽지 못했습니다.')
  }
  const manifest = parseManifest(parsed)

  let offset = dataOffset
  const files = manifest.files.map((file) => {
    const end = offset + file.size
    if (!Number.isSafeInteger(end) || end > input.byteLength) {
      throw new Error(`${file.name}: 압축 업로드 데이터가 잘렸습니다.`)
    }
    // Copy into an exact Uint8Array. Node Buffers override `slice()` with a
    // shared view whose `.buffer` can include the entire bundle.
    const bytes = new Uint8Array(file.size)
    bytes.set(input.subarray(offset, end))
    offset = end
    return { name: file.name, bytes }
  })
  if (offset !== input.byteLength) throw new Error('압축 업로드 데이터 길이가 일치하지 않습니다.')

  return {
    fields: {
      mode: manifest.mode,
      asOfDate: manifest.asOfDate,
      domesticInventoryReflectedThrough: manifest.domesticInventoryReflectedThrough,
      purchasePlanConfirmedSince: manifest.purchasePlanConfirmedSince,
    } satisfies PurchasingRawDataBundleFields,
    files,
  }
}

function parseManifest(value: unknown): BundleManifest {
  if (!value || typeof value !== 'object') throw new Error('압축 업로드 파일 정보가 올바르지 않습니다.')
  const candidate = value as Record<string, unknown>
  if (candidate.version !== BUNDLE_VERSION) throw new Error('지원하지 않는 압축 업로드 형식입니다.')
  if (candidate.mode !== 'preview' && candidate.mode !== 'apply') {
    throw new Error('압축 업로드 처리 방식이 올바르지 않습니다.')
  }
  if (!Array.isArray(candidate.files)) throw new Error('압축 업로드 파일 목록이 올바르지 않습니다.')

  return {
    version: BUNDLE_VERSION,
    mode: candidate.mode,
    asOfDate: requiredString(candidate.asOfDate, 'asOfDate'),
    domesticInventoryReflectedThrough: requiredString(
      candidate.domesticInventoryReflectedThrough,
      'domesticInventoryReflectedThrough',
    ),
    purchasePlanConfirmedSince: requiredString(
      candidate.purchasePlanConfirmedSince,
      'purchasePlanConfirmedSince',
    ),
    files: candidate.files.map((file, index) => {
      if (!file || typeof file !== 'object') throw new Error(`${index + 1}번째 파일 정보가 올바르지 않습니다.`)
      const item = file as Record<string, unknown>
      const name = requiredString(item.name, `${index + 1}번째 파일명`)
      if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0) {
        throw new Error(`${name}: 파일 크기가 올바르지 않습니다.`)
      }
      return { name, size: item.size }
    }),
  }
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 값을 입력해주세요.`)
  return value.trim()
}
