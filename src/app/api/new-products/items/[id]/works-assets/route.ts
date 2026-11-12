import {NextResponse} from 'next/server'
import {getCurrentUser} from '@/lib/auth/current-user'
import {getWorkspaceUserId} from '@/lib/admin-accounts/queries'
import {listWorksAssets} from '@/lib/new-products/works-assets'
export const dynamic='force-dynamic'
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser()
 if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401})
 const {id}=await params
 if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))return NextResponse.json({error:'상품 번호를 확인해주세요.'},{status:400})
 const assets=await listWorksAssets(await getWorkspaceUserId(user.id),id)
 return NextResponse.json({assets},{headers:{'Cache-Control':'private, no-store'}})
}
