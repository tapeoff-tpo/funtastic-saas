import { NextResponse } from 'next/server'

/**
 * GET /api/health
 * Railway health check endpoint.
 * Returns 200 OK when the Next.js server is up.
 */
export async function GET() {
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() })
}
