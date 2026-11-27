// @vitest-environment node
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { renderQualityPdfLabels } from '@/lib/coupang-registration/quality-label-renderer'

/** A vector label with a black square, without external fonts or private files. */
function labelPdf(width: number, height: number) {
  const content = `0 0 0 rg 10 10 ${width / 3} ${height / 3} re f\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf))
}

const input = (width: number, height: number) => ({
  attachmentId: '1d063dc9-1f43-46be-b90c-317cf714ca19',
  fileName: '40mm label.pdf',
  bytes: labelPdf(width, height),
})

describe('Supplier Hub quality label resolution', () => {
  it('renders a 40mm PDF above the Hub minimum and preserves its vector content', async () => {
    const files = await renderQualityPdfLabels(input(40 / 25.4 * 72, 40 / 25.4 * 72))
    expect(files).toHaveLength(1)
    const image = await loadImage(Buffer.from(files[0].data, 'base64'))
    expect(image.width).toBeGreaterThanOrEqual(600)
    expect(image.height).toBeGreaterThanOrEqual(600)
    expect(image.width).toBe(image.height)
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    expect(context.getImageData(0, 0, 1, 1).data[0]).toBeGreaterThan(240)
    expect(context.getImageData(Math.floor(image.width / 5), Math.floor(image.height * 4 / 5), 1, 1).data[0]).toBeLessThan(20)
  })

  it('keeps large PDF pages within the image side and memory limits', async () => {
    const [file] = await renderQualityPdfLabels(input(4000, 4000))
    const image = await loadImage(Buffer.from(file.data, 'base64'))
    expect(image.width).toBeLessThanOrEqual(8000)
    expect(image.height).toBeLessThanOrEqual(8000)
    expect(image.width * image.height).toBeLessThanOrEqual(12_000_000)
  })

  it('rejects a page that cannot meet both side limits without cropping', async () => {
    await expect(renderQualityPdfLabels(input(500, 10000))).rejects.toThrow('600~8,000px')
  })
})
