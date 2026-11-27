import { afterAll, describe, expect, test } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { ScanResult } from '@/domain/types'
import { runScan } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import type { ExtractResult } from '@/parsers/pdf/extract'
import { classify, parseSourceArchive } from '@/parsers/source/archive'
import { texAuthorNames, texCommands, texHiddenRanges } from '@/normalize/tex'
import { buildReport, DEFAULT_REPORT_OPTIONS } from '@/report/build'
import { compareScans } from '@/app/compare'
import { extractBytes } from './helpers/node-pdf'
import { makeJpegWithMeta } from './helpers/make-binary'
import { makePaper } from './helpers/make-pdf'

const TEX = String.raw`\documentclass{article}
\usepackage[final]{neurips_2026}
\hypersetup{pdfauthor={Alex Example}}
\title{Robust Widget Alignment}
\author{Alex Example \\ Example State University \And Blair Sample\thanks{Work done at Example Lab.}}
\begin{document}
\maketitle
% TODO ask alex.example@example-state.edu about the baseline
We study widgets. 50\% of them are aligned.
\iffalse
\section*{Acknowledgments}
We thank Blair Sample for discussions.
\fi
\begin{comment}
see /home/aexample/data
\end{comment}
\end{document}
`

const ANON_TEX = String.raw`\documentclass[sigconf,review,anonymous]{acmart}
\author{Anonymous Author(s)}
\begin{document}
We study widgets.
\end{document}
`

function docx(creator: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'docProps/core.xml': strToU8(`<cp:coreProperties><dc:creator>${creator}</dc:creator><cp:lastModifiedBy>${creator}</cp:lastModifiedBy></cp:coreProperties>`),
  })
}

function project(): Uint8Array {
  return zipSync({
    'paper/main.tex': strToU8(TEX),
    'paper/refs.bib': strToU8('@article{x, author={Blair Sample}, title={T}}'),
    'paper/main.log': strToU8('(C:\\Users\\aexample\\Documents\\paper\\main.tex'),
    'paper/figs/photo.jpg': makeJpegWithMeta({ artist: 'Alex Example', gps: true }),
    'paper/notes.docx': docx('Blair Sample'),
    'code/train.py': strToU8('__author__ = "Blair Sample"\n# clone https://github.com/aexample/widgets\nprint(1)\n'),
    'code/LICENSE': strToU8('MIT License\n\nCopyright (c) 2026 Blair Sample\n'),
    'code/alex_example_utils.py': strToU8('x = 1\n'),
    '.git/config': strToU8('[remote "origin"]\n\turl = git@github.com:aexample/widgets.git\n'),
    '.git/logs/HEAD': strToU8('0000 1111 Alex Example <alex@example-state.edu> 1700000000 +0000\tcommit: init\n'),
    '.git/objects/ab/cdef': new Uint8Array([1, 2, 3]),
    '__MACOSX/._main.tex': new Uint8Array([0]),
    '.DS_Store': new Uint8Array([0, 0, 0, 1]),
    'paper/supplement.pdf': strToU8('%PDF-1.7'),
  })
}

const opened: ExtractResult[] = []
afterAll(async () => {
  for (const r of opened) await r.pdf.loadingTask.destroy()
})

const rulesOf = (r: ScanResult, id: string) => r.findings.filter((f) => f.ruleIds.includes(id))

describe('LaTeX 工具', () => {
  test('注释、\\iffalse 与 comment 环境；转义的 \\% 不算注释', () => {
    const ranges = texHiddenRanges(TEX)
    const kinds = ranges.map((r) => r[2])
    expect(kinds).toContain('comment')
    expect(kinds).toContain('iffalse')
    expect(kinds).toContain('commentEnv')
    const pct = TEX.indexOf('50\\%')
    expect(ranges.some(([a, b]) => pct >= a && pct < b)).toBe(false)
  })

  test('带嵌套花括号的命令参数与 \\author 姓名', () => {
    const [a] = texCommands(TEX, 'author')
    expect(a!.content).toContain('\\thanks{Work done at Example Lab.}')
    expect(texAuthorNames([TEX]).sort()).toEqual(['Alex Example', 'Blair Sample'])
    expect(texAuthorNames([ANON_TEX])).toEqual([])
  })

  test('文件分类', () => {
    expect(classify('a/.git/config')).toBe('vcs')
    expect(classify('__MACOSX/x')).toBe('junk')
    expect(classify('main.synctex.gz')).toBe('build')
    expect(classify('LICENSE')).toBe('text')
    expect(classify('fig.PNG')).toBe('image')
    expect(classify('data.bin')).toBe('binary')
  })
})

describe('源文件包检查', () => {
  test('解析 zip：文本、元数据、版本库、警告', async () => {
    const src = await parseSourceArchive('project.zip', project())
    expect(src.texts.map((t) => t.path)).toEqual(expect.arrayContaining(['paper/main.tex', 'code/train.py', 'paper/main.log', '.git/config']))
    expect(src.texts.some((t) => t.path.includes('objects'))).toBe(false)
    expect(src.vcsDirs).toEqual(['.git'])
    expect(src.meta.find((m) => m.path.endsWith('.jpg'))?.gps).toBe(true)
    expect(src.meta.find((m) => m.path.endsWith('.docx'))?.fields['Office.Creator']).toBe('Blair Sample')
    expect(src.authorNames.sort()).toEqual(['Alex Example', 'Blair Sample'])
    expect(src.warnings.join()).toMatch(/1 个 PDF/)
  })

  test('R22–R25 都能报出，且各有代表性的发现', async () => {
    const source = await parseSourceArchive('project.zip', project())
    const r = runScan([], { presetId: 'generic', userTerms: parseUserTerms(''), strictShortTerms: false, source })
    const r22 = rulesOf(r, 'R22')
    expect(r22.some((f) => f.field === 'paper/main.tex:5' && f.severity === 'high')).toBe(true)
    expect(r22.some((f) => f.reasons.join().includes('pdfauthor'))).toBe(true)
    expect(r22.some((f) => f.reasons.join().includes('终稿'))).toBe(true)

    const r23 = rulesOf(r, 'R23')
    // 注释里的邮箱、\iffalse 中的名字、comment 环境里的本机路径
    expect(r23.some((f) => f.field === 'paper/main.tex:8')).toBe(true)
    expect(r23.some((f) => f.field === 'paper/main.tex:12' && f.reasons.join().includes('iffalse'))).toBe(true)
    expect(r23.some((f) => f.field === 'paper/main.tex:15')).toBe(true)
    // 正文里转义的 50\% 那一行不会被当成注释
    expect(r23.some((f) => f.field === 'paper/main.tex:9')).toBe(false)
    expect(r23.some((f) => f.field?.startsWith('code/LICENSE'))).toBe(true)
    expect(r23.some((f) => f.field?.startsWith('code/train.py:1'))).toBe(true)
    expect(r23.some((f) => f.field?.startsWith('code/train.py:2') && f.reasons.join().includes('aexample'))).toBe(true)
    // .bib 里的第三方作者名不报
    expect(r.findings.some((f) => f.field?.startsWith('paper/refs.bib'))).toBe(false)
    // 命中位置可用于高亮
    expect(r23.every((f) => f.matchInSnippet != null)).toBe(true)

    const r24 = rulesOf(r, 'R24')
    expect(r24.some((f) => f.field === '.git' && f.severity === 'high')).toBe(true)
    expect(r24.some((f) => f.field?.startsWith('paper/main.log'))).toBe(true)
    expect(r24.some((f) => f.field?.startsWith('.git/logs/HEAD'))).toBe(true)
    expect(r24.some((f) => f.severity === 'info')).toBe(true)

    const r25 = rulesOf(r, 'R25')
    expect(r25.some((f) => f.field === 'paper/figs/photo.jpg' && f.snippet.includes('GPS'))).toBe(true)
    expect(r25.some((f) => f.field === 'paper/notes.docx')).toBe(true)
    expect(r25.some((f) => f.field === 'code/alex_example_utils.py')).toBe(true)

    expect(r.source?.fileCount).toBeGreaterThan(10)
    expect(r.coverage.find((c) => c.capability === 'sourceFiles')?.status).toBe('partial')
  })

  test('匿名模板的源码不误报', async () => {
    const source = await parseSourceArchive('paper.tex', new TextEncoder().encode(ANON_TEX))
    const r = runScan([], { presetId: 'generic', userTerms: [], strictShortTerms: false, source })
    expect(r.findings).toHaveLength(0)
  })

  test('\\author 中的姓名用于检查 PDF 正文（PDF 元数据里没有作者）', async () => {
    const pdf = await extractBytes(await makePaper({ authorLines: ['Alex Example', 'Example State University'] }), 'paper.pdf', 'main', 'main')
    opened.push(pdf)
    const without = runScan([pdf.facts], { presetId: 'generic', userTerms: [], strictShortTerms: false })
    const source = await parseSourceArchive('project.zip', project())
    const withSrc = runScan([pdf.facts], { presetId: 'generic', userTerms: [], strictShortTerms: false, source })
    const r03 = (r: ScanResult) => rulesOf(r, 'R03').filter((f) => f.documentId === 'main')
    expect(r03(without)).toHaveLength(0)
    expect(r03(withSrc).some((f) => f.snippet.includes('Alex Example') && f.reasons.join().includes('源文件'))).toBe(true)
  })

  test('报告：源文件包以“源文件包”出现；对比时忽略行号变化', async () => {
    const source = await parseSourceArchive('project.zip', project())
    const r = runScan([], { presetId: 'generic', userTerms: [], strictShortTerms: false, source })
    const rep = buildReport(r, new Map(), DEFAULT_REPORT_OPTIONS)
    expect(rep.documents.find((d) => d.role === 'source')?.name).toBe('源文件包')
    expect(rep.findings.filter((f) => f.document === '源文件包').length).toBe(r.findings.length)
    expect(JSON.stringify(rep)).not.toContain('project.zip')

    // 新版本：在文件开头插入两行，行号全部改变
    const shifted = zipSync({ 'paper/main.tex': strToU8(`% header\n% header\n${TEX}`) })
    const r2 = runScan([], { presetId: 'generic', userTerms: [], strictShortTerms: false, source: await parseSourceArchive('v2.zip', shifted) })
    const prevTex = runScan([], { presetId: 'generic', userTerms: [], strictShortTerms: false, source: await parseSourceArchive('v1.zip', zipSync({ 'paper/main.tex': strToU8(TEX) })) })
    const cmp = compareScans(prevTex, r2)
    expect(cmp.fixed).toHaveLength(0)
    expect(cmp.added).toHaveLength(0)
  })

  test('拒绝过大或无法读取的文件', async () => {
    await expect(parseSourceArchive('x.bin', new Uint8Array([0, 0, 0, 0, 0, 0]))).rejects.toThrow(/只支持/)
    await expect(parseSourceArchive('x.zip', new Uint8Array(51 * 1024 * 1024))).rejects.toThrow(/过大/)
  })
})
