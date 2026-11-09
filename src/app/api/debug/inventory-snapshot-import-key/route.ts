import { NextResponse } from 'next/server'
import { snapshotImportPublicKey } from '@/lib/inventory/snapshot-seed-crypto.mjs'

export const runtime = 'nodejs'

export async function GET() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Import unavailable' }, { status: 503 })
  return NextResponse.json({ publicKey: snapshotImportPublicKey(process.env.DATABASE_URL) }, { headers: { 'Cache-Control': 'no-store' } })
}
