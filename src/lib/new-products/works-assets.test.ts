import {describe,it,expect} from 'vitest'
import {detectWorksAssetType,worksAssetKind} from './works-assets'
describe('Works original asset routing',()=>{
 it('detects actual bytes instead of trusting a filename',()=>{
  expect(detectWorksAssetType(Buffer.from('%PDF-1.7'))).toBe('application/pdf')
  expect(detectWorksAssetType(Buffer.from([0xff,0xd8,0xff,0]))).toBe('image/jpeg')
  expect(detectWorksAssetType(Buffer.from('<svg onload="alert(1)">'))).toBe('application/octet-stream')
  expect(detectWorksAssetType(Buffer.from('GIF89a'))).toBe('image/gif')
  expect(detectWorksAssetType(Buffer.from('RIFF1234WEBP'))).toBe('image/webp')
 })
 it('routes safe images and PDFs to their product attachment category',()=>{
  expect(worksAssetKind('제품 이미지 업로드 产品代表图片','image/jpeg')).toBe('product_image')
  expect(worksAssetKind('샘플 입고 구성품 및 검수 이미지 (중국) 样品入库验收及构成品图片-C(中国)','image/png')).toBe('sample_china_image')
  expect(worksAssetKind('샘플 확정 이미지 및 구성품 (한국) 确定商品及构成品图片 (韩国）','image/jpeg')).toBe('final_sample_image')
  expect(worksAssetKind('품질표시 韩语标签文件','application/pdf')).toBe('quality_pdf')
  expect(worksAssetKind('제품 디자인 파일','application/zip')).toBeNull()
  expect(worksAssetKind('품질표시 韩语标签文件','application/octet-stream')).toBeNull()
 })
})
