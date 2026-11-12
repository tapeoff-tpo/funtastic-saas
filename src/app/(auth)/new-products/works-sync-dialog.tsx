'use client'
import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { FileUp, Loader2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseDaouWorksCsvFile, DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES, type DaouWorksCsvParseResult } from '@/lib/new-products/daou-works-import'
import type { NewProductStage } from '@/lib/new-products/workflow'
import type { WorksSyncResult } from '@/lib/new-products/works-sync'
const fieldLabels:Record<string,string>={referenceNotes:'비고',b2bPrice:'도매가',b2cPrice:'소매가',stageId:'진행 단계',sampleCode:'제품번호',noticeCapacity:'용량',productName:'상품명',costKrw:'원가',noticeSize:'크기',sourceUrl:'제품 URL'}
const reasonLabels:Record<string,string>={ambiguous_name_or_url:'같은 이름의 상품 연결 확인 필요',duplicate_source_id:'중복 원본 ID',existing_sku_requires_review:'기존 품목코드 확인 필요',unmapped_new_stage:'신규 상품 단계 선택 필요',both_changed:'양쪽 수정값 확인',ambiguous_option_key:'중복 옵션 확인',unmapped_stage_preserved:'단계 연결 확인',source_blank_preserved:'원본 빈칸 · 기존값 유지',local_option_removed:'SaaS에서 삭제한 옵션 유지',source_option_removal_preserved:'원본에서 삭제한 옵션 유지',option_identity_changed:'옵션 연결 확인',duplicate_sample_code_preserved:'중복 제품번호 · 기존값 유지'}
function fieldLabel(field:string){if(field.startsWith('options.'))return '옵션 '+(fieldLabels[field.split('.').at(-1)??'']??'정보');return fieldLabels[field]??field}
function displayValue(value:unknown):string {if(value==null||value==='')return '—';if(typeof value==='object'){if(Array.isArray(value))return value.map(displayValue).join(', ');const option=value as Record<string,unknown>;return String(option.optionName??option.sabangnetOptionCode??'옵션 정보')}return String(value)}
const labels={inserted:'신규',linked:'기존 연결',updated:'갱신',unchanged:'동일',review:'검토 필요'}
export function WorksSyncDialog({stages,onImported}:{stages:NewProductStage[];onImported:()=>void}) {
 const [open,setOpen]=useState(false)
 const [parsed,setParsed]=useState<DaouWorksCsvParseResult|null>(null)
 const [mappings,setMappings]=useState<Record<string,string>>({})
 const [results,setResults]=useState<WorksSyncResult[]|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [progress,setProgress]=useState('')
 const [applied,setApplied]=useState(false)
 const [runId,setRunId]=useState('')
 const norm=(s:string)=>s.replace(/^\d+[.-]?\s*/,'').replace(/\s+/g,'')
 async function select(file:File|undefined) {
  setResults(null);setParsed(null);setApplied(false);setError('');setProgress('')
  if(!file)return
  setBusy(true)
  try {
   const value=await parseDaouWorksCsvFile(file)
   setParsed(value);setRunId(crypto.randomUUID())
   setMappings(Object.fromEntries(value.statusCounts.map(({status})=>[status,stages.find(s=>norm(s.name)===norm(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES[status]??'!'))?.id??''])))
  }catch(e){setError(e instanceof Error?e.message:'CSV를 읽지 못했습니다.')}
  finally{setBusy(false)}
 }
 async function sync(preview:boolean) {
  if(!parsed)return
  setBusy(true);setError('')
  const collected:WorksSyncResult[]=[]
  try {
   for(let offset=0;offset<parsed.items.length;offset+=25) {
    setProgress(`${preview?'비교':'반영'} 중 ${Math.min(offset+25,parsed.items.length).toLocaleString()} / ${parsed.items.length.toLocaleString()}건`)
    const response=await fetch('/api/new-products/works-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:parsed.items.slice(offset,offset+25),stageMappings:mappings,preview,runId})})
    const body=await response.json()
    if(!response.ok)throw new Error(body.error??'처리에 실패했습니다.')
    collected.push(...body.results)
   }
   setResults(collected);setApplied(!preview);setProgress(preview?'비교 완료':'반영 완료')
   if(!preview)onImported()
  }catch(e){setError(`${e instanceof Error?e.message:'오류가 발생했습니다.'} 같은 CSV로 다시 실행하면 저장된 WORKS ID를 재사용합니다.`);if(!preview){setResults(collected);setApplied(true);onImported()}}
  finally{setBusy(false)}
 }
 function download(){
  const url=URL.createObjectURL(new Blob([JSON.stringify({runId,applied,results},null,2)],{type:'application/json'}))
  const a=document.createElement('a');a.href=url;a.download=`works-sync-${runId}.json`;a.click();URL.revokeObjectURL(url)
 }
 const counts=Object.fromEntries(Object.keys(labels).map(key=>[key,results?.filter(r=>r.action===key).length??0]))
 const conflicts=results?.filter(r=>r.conflicts.length||r.action==='review')??[]
 return <Dialog.Root open={open} onOpenChange={v=>{if(!busy)setOpen(v)}}>
  <Dialog.Trigger render={props=><Button {...props} variant="outline"><FileUp/>WORKS CSV 동기화</Button>}/>
  <Dialog.Portal><Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40"/><Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(94vw,900px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-background shadow-2xl">
   <div className="border-b p-5"><Dialog.Title className="text-lg font-semibold">WORKS 상품 동기화</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">신규 상품을 추가하고 원본 변경을 반영합니다. 수기 수정값과 빈칸으로 지워질 값은 유지하며, 충돌은 검토 목록에 남깁니다.</Dialog.Description></div>
   <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
    <label className="block space-y-2 text-sm font-medium">WORKS CSV 파일<Input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>void select(e.target.files?.[0])}/></label>
    {parsed&&<><p className="text-sm">상품 {parsed.items.length.toLocaleString()}건 · 원본 {parsed.rawRowCount.toLocaleString()}행</p>
     <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">상태 연결 확인</summary><div className="mt-3 space-y-2">{parsed.statusCounts.map(({status,count})=><label key={status} className="grid grid-cols-2 items-center gap-3 text-xs"><span>{status} ({count})</span><select className="h-9 rounded border bg-background px-2" value={mappings[status]??''} disabled={busy} onChange={e=>{setMappings({...mappings,[status]:e.target.value});setResults(null);setApplied(false)}}><option value="">기존 단계 유지 · 신규는 검토</option>{stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}</div></details>
     <p className="rounded-lg bg-muted/40 p-3 text-xs leading-5">WORKS ID로 우선 연결하며, ID가 없는 상품은 상품명과 원본 URL이 모두 일치할 때 연결합니다. CSV에는 실제 첨부파일이 없으므로 이미지·PDF 파일은 별도 이전이 필요합니다.</p>
    </>}
    {progress&&<p role="status" className="flex items-center gap-2 text-sm">{busy&&<Loader2 className="h-4 w-4 animate-spin"/>}{progress}</p>}
    {error&&<p role="alert" className="rounded border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
    {results&&<><div className="grid grid-cols-5 gap-2">{Object.entries(labels).map(([key,label])=><div key={key} className="rounded-lg border p-3 text-center"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{counts[key].toLocaleString()}</p></div>)}</div><p className="text-sm">{applied?'반영 결과':'비교 결과'} · 기존값 보존 또는 검토 {conflicts.length.toLocaleString()}개 상품</p>
     {conflicts.length>0&&<div className="max-h-64 overflow-auto rounded border"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-muted"><tr><th className="p-2">상품</th><th className="p-2">검토 항목</th><th className="p-2">SaaS 유지값</th><th className="p-2">WORKS 값</th></tr></thead><tbody>{conflicts.flatMap(r=>r.conflicts.length?r.conflicts.map((c,index)=><tr key={`${r.sourceId}-${index}`} className="border-t align-top"><td className="p-2">{r.productName}</td><td className="p-2">{fieldLabel(c.field)}<p className="mt-1 text-muted-foreground">{reasonLabels[c.reason]??'확인 필요'}</p></td><td className="max-w-52 whitespace-pre-wrap break-words p-2">{displayValue(c.current)}</td><td className="max-w-52 whitespace-pre-wrap break-words p-2">{displayValue(c.works)}</td></tr>):[<tr key={r.sourceId} className="border-t"><td className="p-2">{r.productName}</td><td colSpan={3} className="p-2">{reasonLabels[r.reason??'']??'연결 확인 필요'}</td></tr>])}</tbody></table></div>}
     <Button variant="outline" onClick={download} disabled={busy}><Download/>상세 결과 다운로드</Button>
    </>}
   </div>
   <div className="flex justify-end gap-2 border-t p-4"><Dialog.Close render={props=><Button {...props} variant="outline" disabled={busy}>닫기</Button>}/><Button variant="outline" disabled={!parsed||busy} onClick={()=>void sync(true)}>변경사항 비교</Button><Button disabled={!results||applied||busy} onClick={()=>void sync(false)}>{busy?'처리 중…':'비교한 데이터 반영'}</Button></div>
  </Dialog.Popup></Dialog.Portal>
 </Dialog.Root>
}
