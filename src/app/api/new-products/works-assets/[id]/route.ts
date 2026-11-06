import {NextResponse} from 'next/server'
import {getCurrentUser} from '@/lib/auth/current-user'
import {getWorkspaceUserId} from '@/lib/admin-accounts/queries'
import {getWorksAsset,readWorksAssetChunk,getR2Object} from '@/lib/new-products/works-assets'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=300
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser()
 if(!user)return NextResponse.json({error:'로그인이 필요합니다.'},{status:401})
 const {id}=await params
 if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))return new Response(null,{status:404})
 const owner=await getWorkspaceUserId(user.id)
 const asset=await getWorksAsset(owner,id)
 if(!asset)return new Response(null,{status:404})
 if(asset.objectKey){
  try{
   const object=await getR2Object(asset.objectKey)
   return new Response(object.body,{headers:{'Content-Type':asset.contentType,'Content-Length':String(asset.fileSize),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,'Cache-Control':'private, max-age=300','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})
  }catch{return NextResponse.json({error:'보관 파일을 읽지 못했습니다.'},{status:502})}
 }
 let offset=0;let cancelled=false
 const stream=new ReadableStream<Uint8Array>({
  async pull(controller){
   if(cancelled||request.signal.aborted){controller.close();return}
   if(offset>=asset.fileSize){controller.close();return}
   try{
    const chunk=await readWorksAssetChunk(owner,id,offset,Math.min((asset.chunked?1024:384)*1024,asset.fileSize-offset),asset.attachmentId,asset.chunked)
    if(!chunk.length)throw Error('원본 파일의 일부를 읽지 못했습니다.')
    offset+=chunk.length
    if(!cancelled)controller.enqueue(new Uint8Array(chunk))
   }catch(error){if(!cancelled)controller.error(error)}
  },cancel(){cancelled=true}
 })
 const inline=new URL(request.url).searchParams.get('preview')==='1'&&['image/jpeg','image/png','image/webp','image/gif'].includes(asset.contentType)
 return new Response(stream,{headers:{'Content-Type':asset.contentType,'Content-Length':String(asset.fileSize),'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,'Cache-Control':'private, max-age=300','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})
}
