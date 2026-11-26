import { PDFDocument, PDFString, StandardFonts } from 'pdf-lib'

export interface PaperSpec {
  title?: string
  /** 标题下方的作者区（每项一行） */
  authorLines?: string[]
  /** 正文行（“1 Introduction” 之后） */
  body?: string[]
  /** 参考文献行（“References” 之后，放在第 2 页） */
  references?: string[]
  /** 给正文某行整体加 URI 链接：行号 → 目标 */
  links?: Record<number, string>
  author?: string
}

const W = 612
const H = 792

/** 合成一份与示例稿件版式一致的最小论文 PDF，只用标准字体，不含任何真实信息 */
export async function makePaper(spec: PaperSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  const R = await doc.embedFont(StandardFonts.TimesRoman)
  const B = await doc.embedFont(StandardFonts.TimesRomanBold)
  const fixed = new Date('2026-11-01T00:00:00Z')
  doc.setCreationDate(fixed)
  doc.setModificationDate(fixed)
  doc.setProducer('pdf-lib test fixture')
  if (spec.author) doc.setAuthor(spec.author)

  const p1 = doc.addPage([W, H])
  p1.drawText(spec.title ?? 'A Study of Synthetic Widgets', { x: 120, y: 700, size: 16, font: B })
  ;(spec.authorLines ?? ['Anonymous Authors']).forEach((l, i) => p1.drawText(l, { x: 230, y: 672 - i * 14, size: 11, font: R }))
  p1.drawText('Abstract', { x: 282, y: 590, size: 11, font: B })
  p1.drawText('We study synthetic widgets under controlled conditions.', { x: 90, y: 572, size: 10, font: R })
  p1.drawText('1 Introduction', { x: 72, y: 520, size: 12, font: B })
  ;(spec.body ?? []).forEach((l, i) => {
    const y = 502 - i * 13
    p1.drawText(l, { x: 72, y, size: 10, font: R })
    const url = spec.links?.[i]
    if (url) {
      const annot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [72, y - 2, 72 + R.widthOfTextAtSize(l, 10), y + 10],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
      })
      p1.node.addAnnot(doc.context.register(annot))
    }
  })
  p1.drawText('1', { x: 303, y: 40, size: 9, font: R })

  if (spec.references?.length) {
    const p2 = doc.addPage([W, H])
    p2.drawText('References', { x: 72, y: 700, size: 12, font: B })
    spec.references.forEach((l, i) => p2.drawText(l, { x: 72, y: 682 - i * 13, size: 9, font: R }))
    p2.drawText('2', { x: 303, y: 40, size: 9, font: R })
  }
  return doc.save()
}
