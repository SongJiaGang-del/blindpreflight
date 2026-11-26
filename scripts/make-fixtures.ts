/**
 * 生成合成测试样本（全部为虚构人名、机构、邮箱与链接，使用保留域名 example.*）。
 * 仅用 PDF 标准 14 字体，不嵌入任何系统字体。
 *
 *   npm run fixtures
 *
 * 输出：public/samples/sample-leaky.pdf、sample-fixed.pdf、sample-supplement.pdf
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples')
const FIXED_DATE = new Date('2026-11-01T00:00:00Z')

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

async function newDoc(): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  const fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
  }
  doc.setCreationDate(FIXED_DATE)
  doc.setModificationDate(FIXED_DATE)
  return { doc, fonts }
}

function text(page: PDFPage, font: PDFFont, s: string, x: number, y: number, size: number): number {
  page.drawText(s, { x, y, size, font })
  return font.widthOfTextAtSize(s, size)
}

/** 画一行并在其中某段子串上加 URI 链接注释 */
function linkedLine(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  before: string,
  linkText: string,
  after: string,
  url: string,
  x: number,
  y: number,
  size: number,
): void {
  const w0 = text(page, font, before, x, y, size)
  const w1 = text(page, font, linkText, x + w0, y, size)
  text(page, font, after, x + w0 + w1, y, size)
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x + w0, y - 2, x + w0 + w1, y + size],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
  })
  page.node.addAnnot(doc.context.register(annot))
}

function stickyNote(doc: PDFDocument, page: PDFPage, author: string, contents: string, x: number, y: number): void {
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [x, y, x + 18, y + 18],
    Name: 'Comment',
    T: PDFString.of(author),
    Contents: PDFString.of(contents),
  })
  page.node.addAnnot(doc.context.register(annot))
}

function setXmp(doc: PDFDocument, creator: string, title: string): void {
  const xml = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <dc:creator><rdf:Seq><rdf:li>${creator}</rdf:li></rdf:Seq></dc:creator>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
   <pdf:Producer>pdfTeX-1.40.26</pdf:Producer>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
  const stream = doc.context.stream(xml, { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream))
}

const TITLE = 'Robust Widget Alignment via Sparse Gadget Priors'
const W = 612
const H = 792

const ABSTRACT = [
  'We study the alignment of widgets under sparse gadget priors. Existing',
  'approaches assume dense supervision, which is rarely available in practice.',
  'We propose a simple estimator with provable guarantees and show that it',
  'improves accuracy on three synthetic benchmarks by a wide margin.',
]

const INTRO_LEAKY = [
  'Widget alignment is a classic problem. In our previous work [3], we introduced',
  'gadget priors and showed that they generalize across synthetic domains.',
  'This paper extends that line of research to the sparse regime.',
]
const INTRO_FIXED = [
  'Widget alignment is a classic problem. Example et al. [3] introduced',
  'gadget priors and showed that they generalize across synthetic domains.',
  'This paper extends that line of research to the sparse regime.',
]

const LEFT_COL = [
  'We now describe the estimator. Let x denote',
  'a widget and g a gadget drawn from the prior.',
  'The objective balances fidelity and sparsity',
  'through a single parameter that controls the',
  'strength of the prior. Our key insight is that',
  'the prior can be estimated without full align-',
  'ment of every pair, which reduces the cost of',
  'training considerably. We give the complete',
  'algorithm in the appendix and analyze its',
  'sample complexity under mild assumptions.',
]
const RIGHT_COL_LEAKY = [
  'As we showed in our earlier paper, the bound',
  'is tight up to constant factors. Data requests',
  'can be sent to alex.example@',
  'example.edu at any time after review.',
  'We evaluate on three synthetic benchmarks and',
  'report mean accuracy over five random seeds.',
  'All baselines use the same widget encoder and',
  'identical gadget budgets for a fair comparison.',
  'Our estimator is consistently the best method',
  'and its variance is the smallest across seeds.',
]
const RIGHT_COL_FIXED = [
  'As shown by prior work, the bound is tight up',
  'to constant factors. Data requests will be',
  'handled through the conference system after',
  'the review period has ended.',
  'We evaluate on three synthetic benchmarks and',
  'report mean accuracy over five random seeds.',
  'All baselines use the same widget encoder and',
  'identical gadget budgets for a fair comparison.',
  'Our estimator is consistently the best method',
  'and its variance is the smallest across seeds.',
]

const REFERENCES = [
  '[1] C. Placeholder. Widgets in the wild. Journal of Synthetic Results, 2021.',
  '[2] D. Mock and E. Stub. Dense supervision for gadgets. In Proc. SampleConf, 2022.',
  '[3] A. Example and B. Sample. Gadget priors for widgets. In Proc. SampleConf, 2024.',
]

async function makeLeaky(): Promise<Uint8Array> {
  const { doc, fonts } = await newDoc()
  const { regular: R, bold: B } = fonts
  doc.setTitle(TITLE)
  doc.setAuthor('Alex Example; Blair Sample')
  doc.setSubject('Submission draft')
  doc.setKeywords(['widgets', 'gadget priors'])
  doc.setCreator('LaTeX with hyperref')
  doc.setProducer('pdfTeX-1.40.26')
  // 自定义 Info 键
  ;(doc as unknown as { getInfoDict(): { set(k: PDFName, v: PDFString): void } })
    .getInfoDict()
    .set(PDFName.of('Institution'), PDFString.of('Example State University'))
  setXmp(doc, 'Alex Example', TITLE)

  // ---- 第 1 页 ----
  const p1 = doc.addPage([W, H])
  text(p1, R, 'Preprint. Camera-ready draft, do not distribute.', 72, 760, 8)
  text(p1, B, TITLE, 120, 700, 16)
  text(p1, R, 'Alex Example 1   Blair Sample 2', 225, 672, 11)
  text(p1, R, '1 Example State University, Department of Computer Science', 170, 657, 9)
  text(p1, R, '2 Sample Institute of Technology', 240, 645, 9)
  text(p1, R, 'Correspondence: alex.example@example.edu', 215, 630, 9)
  text(p1, R, '{alex.example, blair.sample}@cs.example.edu', 212, 618, 9)
  text(p1, B, 'Abstract', 282, 590, 11)
  ABSTRACT.forEach((l, i) => text(p1, R, l, 90, 572 - i * 13, 10))
  text(p1, B, '1 Introduction', 72, 500, 12)
  INTRO_LEAKY.forEach((l, i) => text(p1, R, l, 72, 482 - i * 13, 10))
  linkedLine(
    doc,
    p1,
    R,
    'Code is available at ',
    'https://github.com/example-lab/widget-align',
    '.',
    'https://github.com/example-lab/widget-align',
    72,
    443,
    10,
  )
  linkedLine(doc, p1, R, 'See the ', 'project page', ' for videos.', 'https://www.example.edu/~aexample/widgets', 72, 430, 10)
  text(p1, R, '1', 303, 40, 9)
  // 侧边竖排的预印本标记
  p1.drawText('arXiv:2611.01234v1 [cs.LG] 1 Nov 2026', { x: 30, y: 250, size: 14, font: R, rotate: degrees(90) })

  // ---- 第 2 页（双栏） ----
  const p2 = doc.addPage([W, H])
  text(p2, R, 'Alex Example et al.  Robust Widget Alignment', 72, 760, 8)
  text(p2, B, '2 Method', 54, 710, 12)
  LEFT_COL.forEach((l, i) => text(p2, R, l, 54, 690 - i * 13, 10))
  text(p2, B, '3 Experiments', 318, 710, 12)
  RIGHT_COL_LEAKY.forEach((l, i) => text(p2, R, l, 318, 690 - i * 13, 10))
  text(p2, R, '2', 303, 40, 9)

  // ---- 第 3 页 ----
  const p3 = doc.addPage([W, H])
  text(p3, R, 'Alex Example et al.  Robust Widget Alignment', 72, 760, 8)
  text(p3, B, 'Acknowledgments', 72, 700, 12)
  text(p3, R, 'We thank Casey Placeholder for helpful discussions. This work was supported by the', 72, 682, 10)
  text(p3, R, 'National Science Foundation under Grant No. 1234567 and by Example State University.', 72, 669, 10)
  text(p3, B, 'References', 72, 630, 12)
  REFERENCES.forEach((l, i) => text(p3, R, l, 72, 612 - i * 13, 9))
  text(p3, R, '3', 303, 40, 9)
  stickyNote(doc, p3, 'Alex Example', 'TODO: remove the funding line before submission', 520, 690)

  await doc.attach(new TextEncoder().encode('internal notes (synthetic)'), 'notes-alex-example.txt', {
    mimeType: 'text/plain',
    description: 'Reviewer response draft by Alex Example',
    creationDate: FIXED_DATE,
    modificationDate: FIXED_DATE,
  })
  return doc.save()
}

async function makeFixed(): Promise<Uint8Array> {
  const { doc, fonts } = await newDoc()
  const { regular: R, bold: B } = fonts
  doc.setTitle(TITLE)
  doc.setCreator('LaTeX')
  doc.setProducer('pdfTeX-1.40.26')

  const p1 = doc.addPage([W, H])
  text(p1, R, 'Under review as a conference paper', 72, 760, 8)
  text(p1, B, TITLE, 120, 700, 16)
  text(p1, R, 'Anonymous Authors', 255, 672, 11)
  text(p1, R, 'Paper under double-blind review', 245, 657, 9)
  text(p1, B, 'Abstract', 282, 590, 11)
  ABSTRACT.forEach((l, i) => text(p1, R, l, 90, 572 - i * 13, 10))
  text(p1, B, '1 Introduction', 72, 500, 12)
  INTRO_FIXED.forEach((l, i) => text(p1, R, l, 72, 482 - i * 13, 10))
  linkedLine(
    doc,
    p1,
    R,
    'Code: ',
    'https://anonymous.4open.science/r/widget-align-1A2B',
    '.',
    'https://anonymous.4open.science/r/widget-align-1A2B',
    72,
    443,
    10,
  )
  text(p1, R, '1', 303, 40, 9)

  const p2 = doc.addPage([W, H])
  text(p2, R, 'Under review as a conference paper', 72, 760, 8)
  text(p2, B, '2 Method', 54, 710, 12)
  LEFT_COL.forEach((l, i) => text(p2, R, l, 54, 690 - i * 13, 10))
  text(p2, B, '3 Experiments', 318, 710, 12)
  RIGHT_COL_FIXED.forEach((l, i) => text(p2, R, l, 318, 690 - i * 13, 10))
  text(p2, R, '2', 303, 40, 9)

  const p3 = doc.addPage([W, H])
  text(p3, R, 'Under review as a conference paper', 72, 760, 8)
  text(p3, B, 'References', 72, 700, 12)
  REFERENCES.forEach((l, i) => text(p3, R, l, 72, 682 - i * 13, 9))
  text(p3, R, '3', 303, 40, 9)
  return doc.save()
}

async function makeSupplement(): Promise<Uint8Array> {
  const { doc, fonts } = await newDoc()
  const { regular: R, bold: B } = fonts
  doc.setTitle('Supplementary Material')
  doc.setAuthor('Blair Sample')
  doc.setProducer('pdfTeX-1.40.26')
  const p = doc.addPage([W, H])
  text(p, B, 'Supplementary Material: Robust Widget Alignment', 120, 700, 14)
  text(p, R, 'A Additional Results', 72, 660, 12)
  text(p, R, 'We report additional ablations on the gadget budget and the prior strength.', 72, 640, 10)
  linkedLine(
    doc,
    p,
    R,
    'Videos: ',
    'https://drive.google.com/file/d/1AbCdEfGhIjK/view',
    '',
    'https://drive.google.com/file/d/1AbCdEfGhIjK/view',
    72,
    620,
    10,
  )
  text(p, R, 'This research was funded by the Example Foundation (grant EF-2025-0042).', 72, 600, 10)
  return doc.save()
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const files: Array<[string, Uint8Array]> = [
    ['sample-leaky.pdf', await makeLeaky()],
    ['sample-fixed.pdf', await makeFixed()],
    ['sample-supplement.pdf', await makeSupplement()],
  ]
  for (const [name, bytes] of files) {
    writeFileSync(join(OUT, name), bytes)
    console.log(`${name}: ${bytes.length} bytes`)
  }
}

void main()
