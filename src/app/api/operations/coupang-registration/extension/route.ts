import { readFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'

export const runtime = 'nodejs'
export async function GET() {
  if (!await registrationWorkspace()) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  const zip = new JSZip()
  const directory = path.join(process.cwd(), 'tools/browser-extensions/funtastic-coupang-registration')
  for (const name of ['manifest.json', 'background.js', 'saas-bridge.js', 'supplier-content.js', 'shared.js', 'README.md']) {
    zip.file(`funtastic-coupang-registration/${name}`, await readFile(path.join(directory, name)))
  }
  return new NextResponse(new Uint8Array(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })), { headers: {
    'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store',
    'Content-Disposition': 'attachment; filename="funtastic-coupang-registration.zip"',
  } })
}
