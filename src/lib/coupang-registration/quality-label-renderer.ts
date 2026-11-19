import { createCanvas, type Canvas } from '@napi-rs/canvas'
import type { SavedFile } from './model'
import {
  QUALITY_LABEL_MAX_FILE_BYTES,
  QUALITY_LABEL_MAX_PAGES,
  QUALITY_LABEL_MAX_PIXELS,
  QUALITY_LABEL_MAX_PDF_BYTES,
  QUALITY_LABEL_MAX_TOTAL_BYTES,
  QUALITY_LABEL_RENDER_SCALE,
  qualityLabelFileName,
} from './quality-labels'

type PdfInput = { attachmentId: string; fileName: string; bytes: Uint8Array }

function isPdf(bytes: Uint8Array) {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
}

function jpegWithinLimit(canvas: Canvas, budget: number) {
  for (const quality of [90, 82, 74, 66]) {
    const jpeg = canvas.encodeSync('jpeg', { quality })
    if (jpeg.length <= budget) return jpeg
  }
  throw new Error('변환된 품질표시 이미지가 너무 큽니다. PDF 해상도를 줄여주세요.')
}

/**
 * Converts private Product Management PDFs in the Node runtime. The native
 * canvas dependency renders the PDF page by page, keeping the browser and
 * Vercel function free of Poppler/ImageMagick binaries.
 */
export async function renderQualityPdfLabels(input: PdfInput): Promise<SavedFile[]> {
  if (!isPdf(input.bytes)) throw new Error('품질표시 원본이 올바른 PDF가 아닙니다.')
  if (input.bytes.length > QUALITY_LABEL_MAX_PDF_BYTES) throw new Error('품질표시 PDF는 4MB 이하만 변환할 수 있습니다.')

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(input.bytes),
    disableWorkerRendering: true,
    useSystemFonts: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })
  try {
    const document = await task.promise
    if (!document.numPages || document.numPages > QUALITY_LABEL_MAX_PAGES) {
      throw new Error(`품질표시 PDF는 ${QUALITY_LABEL_MAX_PAGES}페이지 이하만 자동 변환할 수 있습니다.`)
    }

    const labels: SavedFile[] = []
    let totalBytes = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const sourceViewport = page.getViewport({ scale: QUALITY_LABEL_RENDER_SCALE })
      const scale = Math.min(1, Math.sqrt(QUALITY_LABEL_MAX_PIXELS / (sourceViewport.width * sourceViewport.height)))
      const viewport = scale === 1 ? sourceViewport : page.getViewport({ scale: QUALITY_LABEL_RENDER_SCALE * scale })
      const width = Math.ceil(viewport.width)
      const height = Math.ceil(viewport.height)
      if (width < 1 || height < 1 || width * height > QUALITY_LABEL_MAX_PIXELS) throw new Error('품질표시 PDF 페이지 크기를 확인해주세요.')

      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        background: 'white',
      }).promise
      page.cleanup()

      const remaining = QUALITY_LABEL_MAX_TOTAL_BYTES - totalBytes
      const jpeg = jpegWithinLimit(canvas, Math.min(QUALITY_LABEL_MAX_FILE_BYTES, remaining))
      totalBytes += jpeg.length
      if (totalBytes > QUALITY_LABEL_MAX_TOTAL_BYTES) throw new Error('변환된 품질표시 이미지 용량이 너무 큽니다. PDF 해상도를 줄여주세요.')
      labels.push({
        name: qualityLabelFileName(input.fileName, input.attachmentId, pageNumber, document.numPages),
        data: jpeg.toString('base64'),
      })
    }
    return labels
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('품질표시')) throw error
    throw new Error('품질표시 PDF를 JPG로 변환하지 못했습니다. PDF 파일을 확인해주세요.')
  } finally {
    await task.destroy()
  }
}
