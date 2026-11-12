import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getNewProductViewer } from './workflow'
import { DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES, normalizeDaouWorksImportItems } from './daou-works-import'
import { mergeWorksProduct, stableJson, WORKS_SYNC_COLUMNS, type SyncRow, type SyncConflict } from './works-sync-merge'

type Identity = { id: string; daou_works_id: string | null; product_name: string; source_url: string | null; sample_code: string | null }
export type WorksSyncResult = { sourceId: string; productName: string; itemId?: string; action: 'inserted'|'linked'|'updated'|'unchanged'|'review'; fields: string[]; conflicts: SyncConflict[]; reason?: string }
const rows = <T>(value: unknown) => value as T[]
const normalizeName = (v: string | null) => (v ?? '').normalize('NFC').trim()
const sampleKey = (v: string | null) => normalizeName(v).toLowerCase()

export function matchWorksIdentity(identities: Identity[], sourceId: string, name: string, url: string | null) {
  const exact = identities.filter(row => row.daou_works_id === sourceId)
  if (exact.length) return exact.length === 1 ? { match: exact[0] } : { reason: 'duplicate_source_id' }
  const names = identities.filter(row => normalizeName(row.product_name) === normalizeName(name))
  const linked = url ? names.filter(row => !row.daou_works_id && normalizeName(row.source_url) === normalizeName(url)) : []
  if (linked.length === 1) return { match: linked[0] }
  if (names.length) return { reason: 'ambiguous_name_or_url' }
  return {}
}

/** Non-destructive source sync. No item-master or order writes. Every changed row has an atomic before/after audit. */
export async function syncWorksProducts(input: {
  userId: string; requestedByUserId: string; items: unknown; stageMappings?: unknown; preview?: boolean; runId?: string
}) {
  const viewer = await getNewProductViewer({ userId: input.userId, actorUserId: input.requestedByUserId })
  if (!viewer.isMain) throw new Error('WORKS 동기화는 메인만 실행할 수 있습니다.')
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 25) throw new Error('한 번에 1~25개 상품을 처리할 수 있습니다.')
  const items = normalizeDaouWorksImportItems(input.items)
  if (items.length !== input.items.length || items.some(i => !/^\d{1,24}$/.test(i.sourceId))) throw new Error('중복 또는 유효하지 않은 WORKS 상품이 포함되어 있습니다.')
  const runId = input.runId && /^[\w-]{1,80}$/.test(input.runId) ? input.runId : randomUUID()
  if (!input.preview) await ensureSyncAuditTable()

  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-daou-import:${input.userId}`}))`)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`new-product-number:${input.userId}`}))`)
    const identities = rows<Identity>(await tx.execute(sql`SELECT id, daou_works_id, product_name, source_url, sample_code FROM new_product_workflow_items WHERE user_id=${input.userId}::uuid`))
    const stages = rows<{id:string;name:string}>(await tx.execute(sql`SELECT id,name FROM new_product_workflow_stages WHERE user_id=${input.userId}::uuid`))
    const stageIds: Record<string,string> = {}
    const stageName = (v:string) => v.replace(/^\d+[.-]?\s*/, '').replace(/\s+/g,'').normalize('NFC')
    const mappings = input.stageMappings && typeof input.stageMappings === 'object' ? input.stageMappings as Record<string,unknown> : {}
    for (const [status,name] of Object.entries(DAOU_WORKS_SUGGESTED_SAAS_STAGE_NAMES)) {
      const stage = name && stages.find(s => stageName(s.name) === stageName(name))
      if (stage) stageIds[status] = stage.id
    }
    for (const [status,id] of Object.entries(mappings)) {
      if (!id) continue
      if (typeof id !== 'string' || !stages.some(s=>s.id===id)) throw new Error('현재 SaaS 단계를 다시 선택해주세요.')
      stageIds[status] = id
    }
    const [{next}] = rows<{next:number}>(await tx.execute(sql`SELECT COALESCE(MAX(product_number),0)::int+1 AS next FROM new_product_workflow_items WHERE user_id=${input.userId}::uuid`))
    let nextNumber = next
    const results: WorksSyncResult[] = []
    for (const item of items) {
      const identity = matchWorksIdentity(identities,item.sourceId,item.values.productName,item.values.sourceUrl)
      const result: WorksSyncResult = { sourceId:item.sourceId,productName:item.values.productName,action:'review',fields:[],conflicts:[] }
      if (identity.reason) { results.push({...result,reason:identity.reason}); continue }
      const found = identity.match
      // New identities must not collide with any existing SKU, including child options.
      if (!found) {
        const codes = [...new Set([item.values.sabangnetCode,...(item.values.optionDetails??[]).map(o=>o.sabangnetOptionCode)].filter((c):c is string=>Boolean(c)))]
        if (codes.length) {
          const hits = rows<{id:string}>(await tx.execute(sql`SELECT id FROM new_product_workflow_items WHERE user_id=${input.userId}::uuid AND (
            sabangnet_code IN (${sql.join(codes.map(c=>sql`${c}`),sql`,`)}) OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(metadata->'optionDetails','[]'::jsonb)) o WHERE o->>'sabangnetOptionCode' IN (${sql.join(codes.map(c=>sql`${c}`),sql`,`)})
            )) LIMIT 1`))
          if(hits.length) { results.push({...result,reason:'existing_sku_requires_review'}); continue }
        }
      }
      const before = found ? rows<{item:SyncRow}>(await tx.execute(sql`SELECT to_jsonb(i) AS item FROM new_product_workflow_items i WHERE user_id=${input.userId}::uuid AND id=${found.id}::uuid FOR UPDATE`))[0]?.item : null
      if (found && !before) throw new Error('대상 상품이 변경되었습니다. 다시 확인해주세요.')
      if (!before && !stageIds[item.sourceStatus]) {results.push({...result,reason:'unmapped_new_stage'});continue}
      const current:SyncRow = before ?? {id:randomUUID(),metadata:{},stage_id:stageIds[item.sourceStatus]}
      const merged = mergeWorksProduct(current,item,stageIds)
      const patch:Record<string,unknown> = {...merged.patch}
      const code = typeof patch.sample_code === 'string' ? patch.sample_code : null
      if(code && identities.some(row=>row.id!==current.id&&sampleKey(row.sample_code)===sampleKey(code))) {
        delete patch.sample_code
        merged.conflicts.push({field:'sampleCode',baseline:null,current:before?.sample_code??null,works:code,reason:'duplicate_sample_code_preserved'})
        const meta = merged.metadata as Record<string,unknown>
        const sync = meta.worksSync as Record<string,unknown>
        sync.baselineValues = {...sync.baselineValues as object,sampleCode:before?.sample_code??null}
      }
      result.itemId=current.id
      result.conflicts=merged.conflicts
      result.fields=Object.keys(patch)
      result.action = !before ? 'inserted' : !before.daou_works_id ? 'linked' : Object.keys(patch).length || stableJson(merged.metadata)!==stableJson(before.metadata) ? 'updated' : 'unchanged'
      if (result.action==='unchanged') {results.push(result);continue}
      const values = {...patch,metadata:merged.metadata,daou_works_id:item.sourceId,updated_at:new Date().toISOString()}
      if(!before) Object.assign(values,{id:current.id,user_id:input.userId,product_number:nextNumber++,stage_id:stageIds[item.sourceStatus],created_by_user_id:input.requestedByUserId})
      if(!input.preview) {
        const columns=Object.keys(values)
        const allowed=new Set([...Object.values(WORKS_SYNC_COLUMNS),'metadata','daou_works_id','updated_at','id','user_id','product_number','stage_id','created_by_user_id'])
        if(columns.some(c=>!allowed.has(c)))throw new Error('지원하지 않는 동기화 필드입니다.')
        if(before) await tx.execute(sql`UPDATE new_product_workflow_items AS target SET ${sql.join(columns.map(c=>sql`${sql.identifier(c)}=data.${sql.identifier(c)}`),sql`, `)} FROM jsonb_populate_record(NULL::new_product_workflow_items,${JSON.stringify(values)}::jsonb) data WHERE target.id=${current.id}::uuid AND target.user_id=${input.userId}::uuid`)
        else await tx.execute(sql`INSERT INTO new_product_workflow_items (${sql.join(columns.map(c=>sql.identifier(c)),sql`,`)}) SELECT ${sql.join(columns.map(c=>sql`data.${sql.identifier(c)}`),sql`,`)} FROM jsonb_populate_record(NULL::new_product_workflow_items,${JSON.stringify(values)}::jsonb) data`)
        const [{after}] = rows<{after:unknown}>(await tx.execute(sql`SELECT to_jsonb(i) AS after FROM new_product_workflow_items i WHERE id=${current.id}::uuid AND user_id=${input.userId}::uuid`))
        await tx.execute(sql`INSERT INTO new_product_works_sync_audit(user_id,actor_user_id,run_id,item_id,source_id,action,before_row,after_row,conflicts) VALUES (${input.userId}::uuid,${input.requestedByUserId}::uuid,${runId},${current.id}::uuid,${item.sourceId},${result.action},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb,${JSON.stringify(result.conflicts)}::jsonb)`)
      }
      const identityUpdate:Identity={id:current.id,daou_works_id:item.sourceId,product_name:String(patch.product_name??before?.product_name??item.values.productName),source_url:(patch.source_url??before?.source_url??null) as string|null,sample_code:(patch.sample_code??before?.sample_code??null) as string|null}
      const existingIndex=identities.findIndex(row=>row.id===current.id)
      if(existingIndex>=0)identities[existingIndex]=identityUpdate;else identities.push(identityUpdate)
      results.push(result)
    }
    return {runId,preview:Boolean(input.preview),processed:items.length,results}
  })
}

let auditSchemaPromise: Promise<void> | undefined
function ensureSyncAuditTable() {
  auditSchemaPromise ??= (async () => {
    await db.transaction(async tx => {
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS new_product_works_sync_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, actor_user_id uuid NOT NULL,
      run_id text NOT NULL, item_id uuid NOT NULL, source_id text NOT NULL, action text NOT NULL,
      before_row jsonb, after_row jsonb NOT NULL, conflicts jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`)
    await tx.execute(sql`ALTER TABLE new_product_works_sync_audit ENABLE ROW LEVEL SECURITY`)
    })
  })().catch(error => { auditSchemaPromise = undefined; throw error })
  return auditSchemaPromise
}
