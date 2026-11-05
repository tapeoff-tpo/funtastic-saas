import { importItemFromDaouWorksSource, type DaouWorksImportItem, type DaouWorksSourceData } from './daou-works-import'
import { normalizeNewProductOptionDetails, type NewProductOptionDetail } from './option-details'

export const WORKS_SYNC_COLUMNS: Record<string, string> = Object.fromEntries([
  'sampleCode','productName','productOption','chinaUnitPriceCny','unitShippingCny','exchangeRateKrw','calculatedCostKrw',
  'domesticSaleUrl','domesticSalePrice','detailPageUrl','englishName','sourceUrl','requiredChecks','estimatedCost',
  'historyNotes','referenceNotes','chinaItemName','plannedSaleDate','detailPageDueDate','registeredProductName',
  'packageInfoUrl','packageProgressStatus','packageStatus','koreanManualStatus','declaredValue','b2bPrice','b2cPrice',
  'carrier','b2bShippingFee','b2cShippingFee','qualityNoticeStatus','packageBoxDesign','packageManufacturer','packagePacking',
  'sabangnetCode','productKeywords','purchaseReferenceNotes','previousCostKrw','b2bOptionSurcharge','b2cOptionSurcharge',
  'noticeMaterial','noticeSize','noticeManufacturer','noticeWeight','noticeCountry','noticeCapacity','noticeFoodSafety',
  'noticeComponents','noticeSpecialNotes',
].map(key => [key,key.replace(/[A-Z]/g, x=>'_'+x.toLowerCase())]).concat([['memo1','memo_1'],['memo2','memo_2']]))

export type SyncRow = Record<string, unknown> & { id: string; metadata?: Record<string, unknown> | null }
export type SyncConflict = { field: string; baseline: unknown; current: unknown; works: unknown; reason: string }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(stableJson).join(',')+']'
  if (value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stableJson(v)).join(',')+'}'
  return JSON.stringify(value ?? null)
}
function empty(v:unknown) { return v==null || typeof v==='string' && (!v.trim() || v.trim().toLowerCase()==='null') }
function equal(a:unknown,b:unknown) {
  if(empty(a)&&empty(b))return true
  if(typeof a==='number'||typeof b==='number')return !empty(a)&&!empty(b)&&Number(a)===Number(b)
  if(typeof a==='string'&&typeof b==='string')return a.normalize('NFC').replace(/\r\n?/g,'\n').trim()===b.normalize('NFC').replace(/\r\n?/g,'\n').trim()
  return stableJson(a)===stableJson(b)
}
function record(v:unknown):Record<string,unknown>{return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}}

export function mergeWorksProduct(current:SyncRow,incoming:DaouWorksImportItem,stageIds:Record<string,string>) {
  const metadata=record(current.metadata);const previous=record(metadata.daouWorks)
  const old=previous.sourceId?importItemFromDaouWorksSource(previous as DaouWorksSourceData):null
  const sync={...record(metadata.worksSync)}
  const baseline={...(old?.values??{}),...record(sync.baselineValues)} as Record<string,unknown>
  const nextBaseline={...baseline};const patch:Record<string,unknown>={};const conflicts:SyncConflict[]=[]
  function choose(field:string,c:unknown,b:unknown,w:unknown):{value:unknown;baseline:unknown} {
    if(equal(c,w))return {value:c,baseline:w}
    if(empty(w)) {
      if(!empty(b)&&!equal(b,w)&&!empty(c))conflicts.push({field,baseline:b,current:c,works:w,reason:'source_blank_preserved'})
      return {value:c,baseline:empty(b)?w:b}
    }
    if((empty(c)&&empty(b))||equal(c,b))return {value:w,baseline:w}
    if(!equal(w,b))conflicts.push({field,baseline:b??null,current:c,works:w,reason:'both_changed'})
    return {value:c,baseline:b??null}
  }
  for(const [key,column] of Object.entries(WORKS_SYNC_COLUMNS)) {
    const w=(incoming.values as unknown as Record<string,unknown>)[key]
    if(w===undefined)continue
    const chosen=choose(key,current[column],baseline[key],w)
    if(!equal(chosen.value,current[column]))patch[column]=chosen.value
    nextBaseline[key]=chosen.baseline
  }
  const rawOptions=Array.isArray(metadata.optionDetails)?metadata.optionDetails:[]
  const existingOptions=normalizeNewProductOptionDetails(rawOptions).map(option=>({...record(rawOptions.find(raw=>record(raw).id===option.id)),...option}))
  const baseOptions=normalizeNewProductOptionDetails(sync.optionBaseline??old?.values.optionDetails)
  const worksOptions=normalizeNewProductOptionDetails(incoming.values.optionDetails)
  const options=existingOptions.map(o=>({...o}));const optionBaseline=baseOptions.map(o=>({...o}));const seenBase=new Set<string>()
  const key=(o:NewProductOptionDetail)=>o.sabangnetOptionCode?'sku:'+o.sabangnetOptionCode:o.optionName?'name:'+o.optionName:'id:'+o.id
  const counts=new Map<string,number>();for(const o of worksOptions)counts.set(key(o),(counts.get(key(o))??0)+1)
  function find(rows:NewProductOptionDetail[],w:NewProductOptionDetail) {
    let hits=w.sabangnetOptionCode?rows.filter(o=>o.sabangnetOptionCode===w.sabangnetOptionCode):[]
    if(!hits.length&&w.optionName)hits=rows.filter(o=>o.optionName===w.optionName&&(!o.sabangnetOptionCode||!w.sabangnetOptionCode||o.sabangnetOptionCode===w.sabangnetOptionCode))
    if(!hits.length&&!w.optionName&&!w.sabangnetOptionCode)hits=rows.filter(o=>o.id===w.id&&!o.optionName&&!o.sabangnetOptionCode)
    return hits.length===1?hits[0]:null
  }
  for(const w of worksOptions) {
    if((counts.get(key(w))??0)>1){conflicts.push({field:'options.'+key(w),baseline:null,current:null,works:w,reason:'ambiguous_option_key'});continue}
    const c=find(options,w);const b=find(baseOptions,w)
    if(b)seenBase.add(b.id)
    if(!c) {
      if(b){if(!equal(b,w))conflicts.push({field:'options.'+key(w),baseline:b,current:null,works:w,reason:'local_option_removed'});continue}
      if(options.some(o=>(w.sabangnetOptionCode&&o.sabangnetOptionCode===w.sabangnetOptionCode)||(w.optionName&&o.optionName===w.optionName))) {conflicts.push({field:'options.'+key(w),baseline:null,current:options.filter(o=>o.optionName===w.optionName),works:w,reason:'option_identity_changed'});continue}
      if(options.length>=200){conflicts.push({field:'options',baseline:null,current:options.length,works:w,reason:'option_limit'});continue}
      let id=w.id;let suffix=2;while(options.some(o=>o.id===id))id=w.id+'-'+suffix++
      options.push({...w,id});optionBaseline.push({...w,id});continue
    }
    const nextBase={...(b??w),id:c.id}
    for(const field of Object.keys(w).filter(f=>f!=='id') as Array<Exclude<keyof NewProductOptionDetail,'id'>>) {
      const chosen=choose('options.'+key(w)+'.'+field,c[field],b?.[field],w[field])
      ;(c as unknown as Record<string,unknown>)[field]=chosen.value
      ;(nextBase as unknown as Record<string,unknown>)[field]=chosen.baseline
    }
    const bi=b?optionBaseline.findIndex(o=>o.id===b.id):-1
    if(bi>=0)optionBaseline[bi]=nextBase;else optionBaseline.push(nextBase)
  }
  for(const b of baseOptions)if(!seenBase.has(b.id)&&!find(worksOptions,b)&&find(options,b))conflicts.push({field:'options.'+key(b),baseline:b,current:find(options,b),works:null,reason:'source_option_removal_preserved'})
  const stage=stageIds[incoming.sourceStatus]
  if(stage) {
    const b=typeof sync.stageBaseline==='string'?sync.stageBaseline:stageIds[String(previous.sourceStatus??'')]
    const chosen=old?choose('stageId',current.stage_id,b,stage):{value:current.stage_id,baseline:stage}
    if(!equal(chosen.value,current.stage_id))patch.stage_id=chosen.value
    sync.stageBaseline=chosen.baseline
  }
  if(!stage)conflicts.push({field:'stageId',baseline:null,current:current.stage_id,works:incoming.sourceStatus,reason:'unmapped_stage_preserved'})
  const sourceChanged=stableJson(previous)!==stableJson(incoming.source)
  const optionsChanged=!equal(existingOptions,options)
  const conflictsChanged=!equal(sync.conflicts??[],conflicts)
  const needsWrite=sourceChanged||optionsChanged||conflictsChanged||Object.keys(patch).length>0||!current.daou_works_id
  const nextMetadata=needsWrite?{...metadata,optionDetails:options,daouWorks:incoming.source,worksSync:{...sync,baselineValues:nextBaseline,optionBaseline,conflicts}}:metadata
  return {patch,metadata:nextMetadata,conflicts,needsWrite,sourceChanged,optionsChanged}
}
