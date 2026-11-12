// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'
vi.mock('@/lib/db', () => ({ db: {} }))
import { readWorksQualityArchive } from '@/lib/new-products/works-quality-files'
const id='1496403206169763840'
async function archive(path:string,data:string){ const zip=new JSZip();zip.file(path,data);return zip.generateAsync({type:'nodebuffer'}) }
describe('Works quality PDF backup import',()=>{
 it('retains the exact Works ID and original PDF filename',async()=>{
  const files=await readWorksQualityArchive(await archive(`${id}/품질표시.pdf`,'%PDF-1.4\n%%EOF'))
  expect(files[0]).toMatchObject({sourceId:id,fileName:'품질표시.pdf'})
  expect((await readWorksQualityArchive(await archive('1737370/기존상품.pdf','%PDF-1.4')))[0].sourceId).toBe('1737370')
 })
 it('rejects wrong types and missing or traversing document folders',async()=>{
  await expect(readWorksQualityArchive(await archive(`${id}/품질표시.pdf`,'html login page'))).rejects.toThrow('올바른 PDF')
  await expect(readWorksQualityArchive(await archive('품질표시.pdf','%PDF-1.4'))).rejects.toThrow('원본 WORKS ID')
  await expect(readWorksQualityArchive(await archive(`bad/../${id}/품질표시.pdf`,'%PDF-1.4'))).rejects.toThrow('원본 WORKS ID')
 })
 it('bounds expansion before buffering compressed PDFs',async()=>{
  const zip=new JSZip();zip.file(`${id}/big.pdf`,'%PDF-'+ 'A'.repeat(4*1024*1024));
  await expect(readWorksQualityArchive(await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}))).rejects.toThrow('용량 제한')
 })
 it('accepts original 4.1 MB print PDFs without reducing quality',async()=>{
  const files=await readWorksQualityArchive(await archive(`${id}/인쇄용.pdf`,'%PDF-'+ 'A'.repeat(4_100_000)))
  expect(files[0].data.length).toBe(4_100_005)
 })
})
