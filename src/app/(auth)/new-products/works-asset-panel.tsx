'use client'
import {useEffect,useState} from 'react'
import {Button} from '@/components/ui/button'
import type {WorksAsset} from '@/lib/new-products/works-assets'
export function WorksAssetPanel({itemId}:{itemId:string}){
 const [assets,setAssets]=useState<WorksAsset[]>([])
 const [error,setError]=useState('')
 const [revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController()
  fetch(`/api/new-products/items/${itemId}/works-assets`,{cache:'no-store',signal:controller.signal})
   .then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error??'원본 파일 목록을 읽지 못했습니다.');setAssets(body.assets);setError('')})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
  return()=>controller.abort()
 },[itemId,revision])
 if(error)return <div className="mt-4 flex items-center gap-2 text-xs text-destructive">{error}<Button size="sm" variant="outline" onClick={()=>setRevision(v=>v+1)}>다시 불러오기</Button></div>
 if(!assets.length)return null
 return <details className="mt-4 rounded-lg border">
  <summary className="cursor-pointer px-3 py-2 text-sm font-medium">웍스 원본 첨부파일 {assets.length.toLocaleString()}개</summary>
  <p className="border-t px-3 py-2 text-xs text-muted-foreground">이미지·설명서·디자인 파일을 원본 그대로 보관합니다. 파일명을 누르면 다운로드합니다.</p>
  <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-muted/40"><tr><th className="px-3 py-2">항목</th><th className="px-3 py-2">파일</th><th className="px-3 py-2 text-right">크기</th></tr></thead><tbody>{assets.map(asset=><tr key={asset.id} className="border-t"><td className="max-w-60 px-3 py-2">{asset.fieldName}</td><td className="px-3 py-2"><a className="break-all text-primary underline underline-offset-2" href={`/api/new-products/works-assets/${asset.id}`}>{asset.fileName}</a></td><td className="whitespace-nowrap px-3 py-2 text-right">{asset.fileSize>=1024*1024?`${(asset.fileSize/1024/1024).toFixed(1)} MB`:`${Math.ceil(asset.fileSize/1024)} KB`}</td></tr>)}</tbody></table></div>
 </details>
}
