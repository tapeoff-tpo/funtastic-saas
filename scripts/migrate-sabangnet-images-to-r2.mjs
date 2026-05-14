#!/usr/bin/env node

/**
 * Migrate Sabangnet-hosted image URLs to Cloudflare R2.
 *
 * Reads an .xlsx, .csv, .txt, or .json file, discovers image URLs, downloads
 * each image, uploads it to an R2 bucket, and writes a CSV mapping:
 * old_url,new_url,status,error
 *
 * Required env:
 *   CF_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *   R2_PUBLIC_BASE_URL    e.g. https://cdn.tapeoff.kr
 *
 * Optional env:
 *   R2_PREFIX             default: products
 *   SOURCE_FILE           input file path, also accepted as first CLI arg
 *   OUTPUT_FILE           default: artifacts/r2-image-mapping.csv
 *   URL_COLUMNS           comma-separated column names to scan
 *   PRODUCT_CODE_COLUMNS  comma-separated product-code column names
 *   CONCURRENCY           default: 4
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-sabangnet-images-to-r2.mjs ./sabangnet.xlsx
 *   node --env-file=.env.local scripts/migrate-sabangnet-images-to-r2.mjs ./sabangnet.xlsx --dry-run
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import pLimit from 'p-limit'

const IMAGE_URL_RE = /https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s"'<>]*)?/gi
const DEFAULT_PRODUCT_CODE_COLUMNS = [
  '상품코드',
  '자체상품코드',
  '품번',
  '품목코드',
  '모델명',
  'SKU',
  'sku',
  'product_code',
]

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((arg) => arg.startsWith('--')))
  const positional = args.filter((arg) => !arg.startsWith('--'))
  return {
    sourceFile: positional[0] || process.env.SOURCE_FILE,
    dryRun: flags.has('--dry-run'),
    help: flags.has('--help') || flags.has('-h'),
  }
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env: ${name}`)
  return value
}

function splitEnvList(value) {
  return (value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
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
  return key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function csvEscape(value) {
  const str = String(value ?? '')
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function sanitizePathPart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function extensionFromUrl(url, contentType) {
  const pathname = new URL(url).pathname
  const ext = path.extname(pathname).toLowerCase().replace('.', '')
  if (ext) return ext === 'jpeg' ? 'jpg' : ext

  const type = String(contentType || '').toLowerCase()
  if (type.includes('jpeg')) return 'jpg'
  if (type.includes('png')) return 'png'
  if (type.includes('gif')) return 'gif'
  if (type.includes('webp')) return 'webp'
  if (type.includes('svg')) return 'svg'
  return 'jpg'
}

function contentTypeFromExt(ext) {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

function findUrlsInText(text) {
  return Array.from(String(text || '').matchAll(IMAGE_URL_RE)).map((m) =>
    m[0].replace(/[),.;]+$/, ''),
  )
}

function rowProductCode(row, configuredColumns) {
  const candidates = configuredColumns.length > 0 ? configuredColumns : DEFAULT_PRODUCT_CODE_COLUMNS
  for (const col of candidates) {
    const value = row[col]
    if (value != null && String(value).trim()) return sanitizePathPart(value)
  }
  return ''
}

async function readSourceRows(sourceFile) {
  const ext = path.extname(sourceFile).toLowerCase()

  if (ext === '.txt') {
    const text = await fs.readFile(sourceFile, 'utf8')
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => ({ __row: index + 1, value: line }))
  }

  if (ext === '.json') {
    const parsed = JSON.parse(await fs.readFile(sourceFile, 'utf8'))
    if (Array.isArray(parsed)) return parsed
    return [parsed]
  }

  const workbook = new ExcelJS.Workbook()
  if (ext === '.csv') {
    const sheet = await workbook.csv.readFile(sourceFile)
    return worksheetToObjects(sheet)
  }

  await workbook.xlsx.readFile(sourceFile)
  const rows = []
  workbook.eachSheet((sheet) => {
    rows.push(...worksheetToObjects(sheet, sheet.name))
  })
  return rows
}

function worksheetToObjects(sheet, sheetName = sheet.name) {
  const headerRow = sheet.getRow(1)
  const headers = []
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.text || cell.value || `col_${col}`).trim()
  })

  const rows = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const obj = { __sheet: sheetName, __row: rowNumber }
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const header = headers[col] || `col_${col}`
      obj[header] = cell.text || cell.value || ''
    })
    rows.push(obj)
  })
  return rows
}

function extractImageJobs(rows) {
  const urlColumns = splitEnvList(process.env.URL_COLUMNS)
  const productCodeColumns = splitEnvList(process.env.PRODUCT_CODE_COLUMNS)
  const seen = new Map()

  for (const row of rows) {
    const productCode = rowProductCode(row, productCodeColumns)
    const values = urlColumns.length > 0
      ? urlColumns.map((col) => row[col]).filter(Boolean)
      : Object.values(row)

    for (const value of values) {
      for (const oldUrl of findUrlsInText(value)) {
        if (!seen.has(oldUrl)) {
          seen.set(oldUrl, {
            oldUrl,
            productCode,
            sourceRow: row.__row ?? '',
            sourceSheet: row.__sheet ?? '',
          })
        }
      }
    }
  }

  return Array.from(seen.values())
}

function buildObjectKey({ oldUrl, productCode, index, ext }) {
  const prefix = sanitizePathPart(process.env.R2_PREFIX || 'products') || 'products'
  const hash = sha256Hex(oldUrl).slice(0, 16)
  const folder = productCode || 'unmapped'
  return `${prefix}/${folder}/${String(index + 1).padStart(4, '0')}-${hash}.${ext}`
}

async function downloadImage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Funtastic-SaaS-Image-Migrator/1.0',
    },
  })
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`)
  const arrayBuffer = await res.arrayBuffer()
  return {
    body: Buffer.from(arrayBuffer),
    contentType: res.headers.get('content-type') || '',
  }
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
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = hmac(
    hmac(
      hmac(
        hmac(Buffer.from(`AWS4${secretAccessKey}`), dateStamp),
        'auto',
      ),
      's3',
    ),
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
  const header = ['old_url', 'new_url', 'object_key', 'status', 'error', 'source_sheet', 'source_row']
  const lines = [
    header.join(','),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(',')),
  ]
  await fs.writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8')
}

async function main() {
  const args = parseArgs()
  if (args.help || !args.sourceFile) {
    console.log(`
Usage:
  node --env-file=.env.local scripts/migrate-sabangnet-images-to-r2.mjs ./sabangnet.xlsx
  node --env-file=.env.local scripts/migrate-sabangnet-images-to-r2.mjs ./sabangnet.xlsx --dry-run

Required env:
  CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
`)
    return
  }

  const sourceFile = path.resolve(args.sourceFile)
  const outputFile = process.env.OUTPUT_FILE || 'artifacts/r2-image-mapping.csv'
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (!args.dryRun && !publicBaseUrl) requiredEnv('R2_PUBLIC_BASE_URL')

  const rows = await readSourceRows(sourceFile)
  const jobs = extractImageJobs(rows)
  if (jobs.length === 0) {
    console.log(`No image URLs found in ${sourceFile}`)
    return
  }

  console.log(`Found ${jobs.length} unique image URL(s).`)
  const limit = pLimit(Number(process.env.CONCURRENCY || 4))
  const results = []

  await Promise.all(jobs.map((job, index) => limit(async () => {
    const base = {
      old_url: job.oldUrl,
      source_sheet: job.sourceSheet,
      source_row: job.sourceRow,
    }

    try {
      if (args.dryRun) {
        const ext = extensionFromUrl(job.oldUrl)
        const objectKey = buildObjectKey({ ...job, index, ext })
        results.push({
          ...base,
          new_url: publicBaseUrl ? `${publicBaseUrl}/${objectKey}` : '',
          object_key: objectKey,
          status: 'dry-run',
          error: '',
        })
        return
      }

      const downloaded = await downloadImage(job.oldUrl)
      const ext = extensionFromUrl(job.oldUrl, downloaded.contentType)
      const objectKey = buildObjectKey({ ...job, index, ext })
      const contentType = downloaded.contentType.startsWith('image/')
        ? downloaded.contentType.split(';')[0]
        : contentTypeFromExt(ext)

      await putObjectToR2({
        key: objectKey,
        body: downloaded.body,
        contentType,
      })

      results.push({
        ...base,
        new_url: `${publicBaseUrl}/${objectKey}`,
        object_key: objectKey,
        status: 'uploaded',
        error: '',
      })
      console.log(`uploaded ${index + 1}/${jobs.length}: ${objectKey}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({
        ...base,
        new_url: '',
        object_key: '',
        status: 'failed',
        error: message,
      })
      console.warn(`failed ${index + 1}/${jobs.length}: ${job.oldUrl} (${message})`)
    }
  })))

  results.sort((a, b) => String(a.old_url).localeCompare(String(b.old_url)))
  await writeMapping(outputFile, results)

  const uploaded = results.filter((row) => row.status === 'uploaded').length
  const failed = results.filter((row) => row.status === 'failed').length
  console.log(`Done. uploaded=${uploaded}, failed=${failed}, mapping=${outputFile}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

