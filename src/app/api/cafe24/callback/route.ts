import { NextRequest, NextResponse } from 'next/server'

/**
 * Cafe24 OAuth callback — displays the authorization code for manual token exchange.
 * Temporary endpoint for initial access token setup.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error) {
    return new NextResponse(`<html><body style="font-family:monospace;padding:40px">
      <h2>오류</h2><p style="color:red">${error}</p>
    </body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }

  if (!code) {
    return new NextResponse(`<html><body style="font-family:monospace;padding:40px">
      <h2>code 없음</h2><p>code 파라미터가 없습니다.</p>
    </body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }

  return new NextResponse(`<html><body style="font-family:monospace;padding:40px;background:#f5f5f5">
    <h2 style="color:#333">Cafe24 인증 코드</h2>
    <p style="color:#666">아래 코드를 복사하세요 (10분 내 사용):</p>
    <div style="background:#000;color:#0f0;padding:20px;border-radius:8px;font-size:18px;word-break:break-all">
      ${code}
    </div>
    <p style="margin-top:20px;color:#999">이 페이지는 토큰 발급 후 닫아도 됩니다.</p>
  </body></html>`, { headers: { 'Content-Type': 'text/html' } })
}
