import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getNewProductViewer } from './workflow'

export type WorksAsset = {
  id: string; fieldName: string; fileName: string; contentType: string; fileSize: number; sha256: string
}
let schemaPromise: Promise<void> | undefined
export function ensureWorksAssets() {
  schemaPromise ??= db.transaction(async tx => {
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS new_product_works_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      item_id uuid NOT NULL REFERENCES new_product_workflow_items(id) ON DELETE CASCADE,
      source_id text NOT NULL, source_file_id text NOT NULL, field_name text NOT NULL,
      file_name text NOT NULL, content_type text NOT NULL, file_size integer NOT NULL,
      sha256 text NOT NULL, file_data bytea,
      attachment_id uuid REFERENCES new_product_workflow_attachments(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK ((file_data IS NOT NULL) <> (attachment_id IS NOT NULL)),
      UNIQUE(user_id,source_id,source_file_id)
    )`)
    await tx.execute(sql`ALTER TABLE new_product_works_assets ALTER COLUMN file_data SET STORAGE EXTERNAL`)
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS new_product_works_assets_item_idx ON new_product_works_assets(user_id,item_id)`)
    await tx.execute(sql`ALTER TABLE new_product_works_assets ENABLE ROW LEVEL SECURITY`)
  }).catch(error => { schemaPromise = undefined; throw error })
  return schemaPromise
}

export function detectWorksAssetType(bytes: Uint8Array) {
  const b=Buffer.from(bytes)
  if(b.subarray(0,5).toString()==='%PDF-')return 'application/pdf'
  if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg'
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png'
  if(/^GIF8[79]a/.test(b.subarray(0,6).toString()))return 'image/gif'
  if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp'
  if(b[0]===80&&b[1]===75&&[3,5,7].includes(b[2]))return 'application/zip'
  return 'application/octet-stream'
}
export function worksAssetKind(field: string, type: string) {
  if (/품질표시/.test(field)&&type==='application/pdf')return 'quality_pdf'
  if (!type.startsWith('image/'))return null
  if (/제품.*이미지.*업로드/.test(field))return 'product_image'
  if (/샘플.*중국|样品入库/.test(field))return 'sample_china_image'
  if (/샘플.*한국|确定商品/.test(field))return 'final_sample_image'
  return null
}

/** Explicit operator migration entry point. Original bytes are retained; no re-encoding. */
export async function saveWorksAsset(input: {
  userId:string; actorUserId:string; sourceId:string; sourceFileId:string; fieldName:string; fileName:string; bytes:Buffer; expectedSha256:string
}) {
  const viewer=await getNewProductViewer({userId:input.userId,actorUserId:input.actorUserId})
  if(!viewer.isMain)throw Error('웍스 파일 이전은 메인만 실행할 수 있습니다.')
  if(!/^\d{1,24}$/.test(input.sourceId)||!/^\d{1,24}$/.test(input.sourceFileId)||!input.fieldName||!input.fileName||!input.bytes.length)throw Error('파일 정보를 확인해주세요.')
  const hash=createHash('sha256').update(input.bytes).digest('hex')
  if(hash!==input.expectedSha256)throw Error('파일 해시가 원본과 다릅니다.')
  const type=detectWorksAssetType(input.bytes)
  // Illustrator files may contain PDF-compatible bytes, but remain original design assets.
  const kind=/\.pdf$/i.test(input.fileName)||type.startsWith('image/')?worksAssetKind(input.fieldName,type):null
  await ensureWorksAssets()
  return db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`works-asset:${input.userId}:${input.sourceId}`}))`)
    const [item]=await tx.execute(sql`SELECT id FROM new_product_workflow_items WHERE user_id=${input.userId}::uuid AND daou_works_id=${input.sourceId} FOR KEY SHARE`)
    if(!item)throw Error('웍스 상품 연결을 찾을 수 없습니다.')
    const [existing]=await tx.execute(sql`SELECT id,sha256,file_name,field_name,attachment_id FROM new_product_works_assets WHERE user_id=${input.userId}::uuid AND source_id=${input.sourceId} AND source_file_id=${input.sourceFileId}`)
    if(existing){if(existing.sha256!==hash)throw Error('같은 원본 파일 ID의 내용이 변경되었습니다. 검토가 필요합니다.');if(existing.file_name===input.fileName&&existing.field_name===input.fieldName)return {id:String(existing.id),status:'existing' as const}}
    let attachmentId:string|null=null
    if(kind&&input.bytes.length<=4*1024*1024){
      const md5=createHash('md5').update(input.bytes).digest('hex')
      const [duplicate]=await tx.execute(sql`SELECT id FROM new_product_workflow_attachments WHERE user_id=${input.userId}::uuid AND item_id=${item.id}::uuid AND kind=${kind} AND file_size=${input.bytes.length} AND md5(file_data)=${md5} LIMIT 1`)
      if(duplicate)attachmentId=String(duplicate.id)
      else {
        const [created]=await tx.execute(sql`INSERT INTO new_product_workflow_attachments(user_id,item_id,kind,file_name,content_type,file_size,file_data,uploaded_by_user_id) VALUES (${input.userId}::uuid,${item.id}::uuid,${kind},${input.fileName},${type},${input.bytes.length},decode(${input.bytes.toString('base64')},'base64'),${input.actorUserId}::uuid) RETURNING id`)
        attachmentId=String(created.id)
      }
    }
    if(existing?.attachment_id&&existing.file_name!==input.fileName)await tx.execute(sql`UPDATE new_product_workflow_attachments SET file_name=${input.fileName} WHERE id=${existing.attachment_id}::uuid AND user_id=${input.userId}::uuid AND file_name=${existing.file_name}`)
    const [asset]=await tx.execute(sql`INSERT INTO new_product_works_assets(user_id,item_id,source_id,source_file_id,field_name,file_name,content_type,file_size,sha256,file_data,attachment_id) VALUES (${input.userId}::uuid,${item.id}::uuid,${input.sourceId},${input.sourceFileId},${input.fieldName},${input.fileName},${type},${input.bytes.length},${hash},${attachmentId?null:sql`decode(${input.bytes.toString('base64')},'base64')`},${attachmentId}::uuid) ON CONFLICT(user_id,source_id,source_file_id) DO UPDATE SET file_name=EXCLUDED.file_name,field_name=EXCLUDED.field_name,file_data=EXCLUDED.file_data,attachment_id=EXCLUDED.attachment_id WHERE new_product_works_assets.sha256=EXCLUDED.sha256 RETURNING id`)
    return {id:String(asset.id),status:'saved' as const,attachmentId}
  })
}

export async function listWorksAssets(userId:string,itemId:string):Promise<WorksAsset[]> {
  await ensureWorksAssets()
  return await db.execute(sql`SELECT id,field_name AS "fieldName",file_name AS "fileName",content_type AS "contentType",file_size AS "fileSize",sha256 FROM new_product_works_assets WHERE user_id=${userId}::uuid AND item_id=${itemId}::uuid ORDER BY field_name,created_at,id`) as unknown as WorksAsset[]
}
export async function getWorksAsset(userId:string,id:string) {
  await ensureWorksAssets()
  const [asset]=await db.execute(sql`SELECT id,file_name AS "fileName",content_type AS "contentType",file_size AS "fileSize",attachment_id AS "attachmentId" FROM new_product_works_assets WHERE id=${id}::uuid AND user_id=${userId}::uuid`)
  return asset as {id:string;fileName:string;contentType:string;fileSize:number;attachmentId:string|null}|undefined
}
export async function readWorksAssetChunk(userId:string,id:string,start:number,length:number,attachmentId:string|null) {
  const [row]=attachmentId ? await db.execute(sql`SELECT encode(substring(file_data FROM ${start+1} FOR ${length}),'base64') AS bytes FROM new_product_workflow_attachments WHERE id=${attachmentId}::uuid AND user_id=${userId}::uuid`) : await db.execute(sql`SELECT encode(substring(file_data FROM ${start+1} FOR ${length}),'base64') AS bytes FROM new_product_works_assets WHERE id=${id}::uuid AND user_id=${userId}::uuid`)
  if(!row)throw Error('파일을 찾을 수 없습니다.')
  return Buffer.from(String(row.bytes),'base64')
}
