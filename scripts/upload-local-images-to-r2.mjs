#!/usr/bin/env node

/**
 * Upload a local product-image folder tree to Cloudflare R2.
 *
 * Expected source shape:
 *   /source/1682. 상품명/file.jpg
 *   /source/완료/상품명/file.jpg
 *
 * Output:
 *   artifacts/r2-local-image-mapping.csv
 *
 * Required env for real upload:
 *   CF_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *   R2_PUBLIC_BASE_URL    e.g. https://cdn.tapeoff.kr
 *
 * Optional env:
 *   R2_PREFIX             default: products
 *   CONCURRENCY           default: 6
 *   OUTPUT_FILE           default: artifacts/r2-local-image-mapping.csv
 *
 * Usage:
 *   node --env-file=.env.local scripts/upload-local-images-to-r2.mjs /Users/tapeoff/Downloads/file --dry-run
 *   node --env-file=.env.local scripts/upload-local-images-to-r2.mjs /Users/tapeoff/Downloads/file
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import pLimit from 'p-limit'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'])
const SKIP_DIRS = new Set(['__MACOSX', '.DS_Store'])

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((arg) => arg.startsWith('--')))
  const positional = args.filter((arg) => !arg.startsWith('--'))
  return {
    sourceDir: positional[0],
    dryRun: flags.has('--dry-run'),
    help: flags.has('--help') || flags.has('-h'),
  }
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env: ${name}`)
  return value
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data).digest(encoding)
}

function isoAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function encodeS3Path(key) {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function csvEscape(value) {
  const str = String(value ?? '')
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function sanitizePathPart(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
}

function productCodeFromFolder(folderName) {
  const normalized = String(folderName || '').normalize('NFC').trim()
  const match = normalized.match(/^(\d{3,})[.)\s-]+(.+)$/)
  if (!match) return { productCode: '', productName: normalized }
  return {
    productCode: match[1],
    productName: match[2].trim(),
  }
}

function contentTypeFromExt(ext) {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

function imageRole(fileName, index) {
  const stem = path.basename(fileName, path.extname(fileName)).normalize('NFC').toLowerCase()
  if (stem.includes('썸네일') || stem.includes('thumbnail') || stem.includes('thumb')) {
    const num = stem.match(/\d+/)?.[0]
    return `thumb${num ? `-${num}` : ''}`
  }
  if (stem === '1' || stem.includes('main') || stem.includes('대표')) return 'main'
  if (stem.includes('상세') || stem.includes('detail')) return 'detail'
  return `image-${String(index + 1).padStart(2, '0')}`
}

async function walkImages(rootDir) {
  const files = []

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'))

    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath)
      }
    }
  }

  await walk(rootDir)
  return files
}

function groupByProduct(rootDir, files) {
  const groups = new Map()

  for (const file of files) {
    const rel = path.relative(rootDir, file)
    const parts = rel.split(path.sep)
    const top = parts[0] || 'unmapped'
    const productFolder = productCodeFromFolder(top).productCode
      ? top
      : parts.length > 2
        ? parts[1]
        : top

    const { productCode, productName } = productCodeFromFolder(productFolder)
    const key = productCode || sanitizePathPart(productName || productFolder) || 'unmapped'
    const group = groups.get(key) || {
      productKey: key,
      productCode,
      productName: productName || productFolder,
      files: [],
    }
    group.files.push({ file, rel })
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    group.files.sort((a, b) => a.rel.localeCompare(b.rel, 'ko', { numeric: true }))
  }

  return Array.from(groups.values()).sort((a, b) => a.productKey.localeCompare(b.productKey, 'ko', { numeric: true }))
}

function buildObjectKey(group, item, index) {
  const prefix = sanitizePathPart(process.env.R2_PREFIX || 'products') || 'products'
  const ext = path.extname(item.file).toLowerCase().replace('.jpeg', '.jpg')
  const productFolder = sanitizePathPart(group.productKey)
  const role = sanitizePathPart(imageRole(path.basename(item.file), index))
  const hash = sha256Hex(item.rel).slice(0, 10)
  return `${prefix}/${productFolder}/${String(index + 1).padStart(3, '0')}-${role}-${hash}${ext}`
}

async function putObjectToR2({ key, body, contentType }) {
  const accountId = requiredEnv('CF_ACCOUNT_ID')
  const accessKeyId = requiredEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = requiredEnv('R2_SECRET_ACCESS_KEY')
  const bucket = requiredEnv('R2_BUCKET')

  const host = `${accountId}.r2.cloudflarestorage.com`
  const now = new Date()
  const amzDate = isoAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(body)
  const canonicalUri = `/${bucket}/${encodeS3Path(key)}`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n')
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmac(
    hmac(hmac(hmac(Buffer.from(`AWS4${secretAccessKey}`), dateStamp), 'auto'), 's3'),
    'aws4_request',
  )
  const signature = hmac(signingKey, stringToSign, 'hex')
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ')

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`upload failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`)
  }
}

async function writeMapping(outputFile, rows) {
  await fs.mkdir(path.dirname(outputFile), { recursive: true })
  const header = [
    'local_path',
    'new_url',
    'object_key',
    'status',
    'error',
    'product_key',
    'product_code',
    'product_name',
    'sort_order',
  ]
  const lines = [
    header.join(','),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(',')),
  ]
  await fs.writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8')
}

async function main() {
  const args = parseArgs()
  if (args.help || !args.sourceDir) {
    console.log(`
Usage:
  node --env-file=.env.local scripts/upload-local-images-to-r2.mjs /Users/tapeoff/Downloads/file --dry-run
  node --env-file=.env.local scripts/upload-local-images-to-r2.mjs /Users/tapeoff/Downloads/file

Required env for real upload:
  CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
`)
    return
  }

  const sourceDir = path.resolve(args.sourceDir)
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || 'https://cdn.tapeoff.kr').replace(/\/+$/, '')
  const outputFile = process.env.OUTPUT_FILE || 'artifacts/r2-local-image-mapping.csv'

  const files = await walkImages(sourceDir)
  const groups = groupByProduct(sourceDir, files)
  console.log(`Found ${files.length} image(s) in ${groups.length} product group(s).`)

  if (!args.dryRun) {
    requiredEnv('CF_ACCOUNT_ID')
    requiredEnv('R2_ACCESS_KEY_ID')
    requiredEnv('R2_SECRET_ACCESS_KEY')
    requiredEnv('R2_BUCKET')
    requiredEnv('R2_PUBLIC_BASE_URL')
  }

  const tasks = []
  for (const group of groups) {
    group.files.forEach((item, index) => {
      tasks.push({ group, item, index })
    })
  }

  const limit = pLimit(Number(process.env.CONCURRENCY || 6))
  const results = []

  await Promise.all(tasks.map((task, taskIndex) => limit(async () => {
    const objectKey = buildObjectKey(task.group, task.item, task.index)
    const newUrl = `${publicBaseUrl}/${objectKey}`
    const base = {
      local_path: task.item.file,
      new_url: newUrl,
      object_key: objectKey,
      product_key: task.group.productKey,
      product_code: task.group.productCode,
      product_name: task.group.productName,
      sort_order: task.index,
    }

    try {
      if (!args.dryRun) {
        const body = await fs.readFile(task.item.file)
        await putObjectToR2({
          key: objectKey,
          body,
          contentType: contentTypeFromExt(path.extname(task.item.file)),
        })
      }

      results.push({ ...base, status: args.dryRun ? 'dry-run' : 'uploaded', error: '' })
      if (!args.dryRun && ((taskIndex + 1) % 25 === 0 || taskIndex + 1 === tasks.length)) {
        console.log(`uploaded ${taskIndex + 1}/${tasks.length}`)
      }
    } catch (error) {
      results.push({
        ...base,
        new_url: '',
        object_key: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })))

  results.sort((a, b) => a.object_key.localeCompare(b.object_key, 'ko', { numeric: true }))
  await writeMapping(outputFile, results)

  const uploaded = results.filter((row) => row.status === 'uploaded').length
  const dry = results.filter((row) => row.status === 'dry-run').length
  const failed = results.filter((row) => row.status === 'failed').length
  console.log(`Done. uploaded=${uploaded}, dry-run=${dry}, failed=${failed}, mapping=${outputFile}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

