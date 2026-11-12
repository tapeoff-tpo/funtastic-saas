import { createHash, createHmac } from 'node:crypto'

const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`R2 환경값이 없습니다: ${name}`)
  return value
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const hmac = (key: string | Buffer, value: string, encoding?: 'hex') => encoding ? createHmac('sha256', key).update(value).digest(encoding) : createHmac('sha256', key).update(value).digest()
const amzDate = () => new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
const encodedKey = (key: string) => key.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')

function signedRequest(method: 'GET' | 'PUT', key: string, body?: Uint8Array, contentType?: string, range?: string) {
  const account = required('CF_ACCOUNT_ID'), bucket = required('R2_BUCKET'), access = required('R2_ACCESS_KEY_ID'), secret = required('R2_SECRET_ACCESS_KEY')
  const host = `${account}.r2.cloudflarestorage.com`, date = amzDate(), dateStamp = date.slice(0, 8), payloadHash = hash(body ?? '')
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': date }
  if (contentType) headers['content-type'] = contentType
  if (range) headers.range = range
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join('')
  const uri = `/${bucket}/${encodedKey(key)}`
  const canonical = [method, uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/auto/s3/aws4_request`
  const signingKey = hmac(hmac(hmac(hmac(Buffer.from(`AWS4${secret}`), dateStamp), 'auto'), 's3'), 'aws4_request')
  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, ['AWS4-HMAC-SHA256', date, scope, hash(canonical)].join('\n'), 'hex')}`
  delete headers.host
  return { url: `https://${host}${uri}`, headers }
}

export async function putR2Object(key: string, body: Uint8Array, contentType: string) {
  const request = signedRequest('PUT', key, body, contentType)
  const response = await fetch(request.url, { method: 'PUT', headers: request.headers, body: Buffer.from(body) })
  if (!response.ok) throw new Error(`R2 업로드 실패 (${response.status})`)
}

export async function getR2Object(key: string, range?: string) {
  const request = signedRequest('GET', key, undefined, undefined, range)
  const response = await fetch(request.url, { headers: request.headers })
  if (!response.ok) throw new Error(`R2 파일 읽기 실패 (${response.status})`)
  return response
}

export function newProductObjectKey(userId: string, table: 'attachments' | 'works-assets', id: string, sha256: string) {
  return `new-products/${userId}/${table}/${id}-${sha256}`
}
