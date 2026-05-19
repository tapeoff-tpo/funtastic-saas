import { NextResponse } from 'next/server'

/**
 * GET /api/health
 * Railway health check endpoint.
 * Returns 200 OK when the Next.js server is up.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
  })
}
