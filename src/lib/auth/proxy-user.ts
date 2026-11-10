import type { NextRequest, NextResponse } from 'next/server'
import { LOCAL_SESSION_COOKIE, validateLocalSession } from './local-session'
export async function getProxyUser(request:NextRequest,_response:NextResponse):Promise<{id:string}|null>{
  return validateLocalSession(request.cookies.get(LOCAL_SESSION_COOKIE)?.value)
}
