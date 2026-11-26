import { describe, expect, test } from 'vitest'
import type { Finding } from '@/domain/types'
import { runScan } from '@/rules/engine'
import { parseUserTerms } from '@/rules/terms'
import { extractBytes } from './helpers/node-pdf'
import { makePaper, type PaperSpec } from './helpers/make-pdf'

async function scanPaper(spec: PaperSpec, terms = ''): Promise<Finding[]> {
  const r = await extractBytes(await makePaper(spec), 'paper.pdf')
  try {
    return runScan([r.facts], { presetId: 'generic', userTerms: parseUserTerms(terms), strictShortTerms: false }, {
      scanId: 't',
      now: () => new Date('2026-11-26T00:00:00Z'),
    }).findings
  } finally {
    await r.pdf.loadingTask.destroy()
  }
}

/** 需要作者处理的发现（高优先级或需核实）；提示级不算误报 */
const actionable = (fs: Finding[]) => fs.filter((f) => f.severity !== 'info')
const describeFs = (fs: Finding[]) => fs.map((f) => `${f.ruleIds.join('+')}/${f.severity}: ${f.snippet.slice(0, 80)}`)

describe('不应报警的写法（误报回归）', () => {
  test('“We propose / our method” 不是自引', async () => {
    const fs = await scanPaper({
      body: [
        'We propose a simple estimator for widget alignment.',
        'Our method outperforms prior baselines, and our experiments confirm it.',
        'In this work we show that our approach scales to large benchmarks.',
      ],
    })
    expect(describeFs(actionable(fs))).toEqual([])
  })

  test('第三人称引用 “Smith et al. [3]” 不报', async () => {
    const fs = await scanPaper({
      body: ['Smith et al. [3] proposed gadget priors.', 'Following Lee and Park [4], we adopt their protocol.'],
      references: ['[3] J. Smith and K. Doe. Gadget priors. In Proc. Widgets, 2024.', '[4] H. Lee and S. Park. Protocols. 2023.'],
    })
    expect(describeFs(actionable(fs))).toEqual([])
  })

  test('参考文献中的机构名不报', async () => {
    const fs = await scanPaper({
      body: ['Prior work studied widgets [1].'],
      references: [
        '[1] A. Author. Widget report. Technical report, Example State University, 2021.',
        '[2] B. Writer. Thesis. Department of Computer Science, Sample Institute of Technology, 2019.',
      ],
    })
    expect(fs.filter((f) => f.ruleIds.includes('R04'))).toEqual([])
  })

  test('公共 GitHub 库与第三方项目不升级为高优先级', async () => {
    const fs = await scanPaper({
      body: ['We implement our model with PyTorch (https://github.com/pytorch/pytorch).', 'Tokenization uses https://github.com/huggingface/transformers.'],
      links: { 0: 'https://github.com/pytorch/pytorch' },
    })
    expect(fs.filter((f) => f.severity === 'high')).toEqual([])
  })

  test('DOI 与 arXiv 编号不报', async () => {
    const fs = await scanPaper({
      body: ['See the survey [2] for details.'],
      references: ['[2] C. Writer. A survey. https://doi.org/10.1000/xyz123, 2022.', '[3] D. Author. Widgets. arXiv:2401.01234, 2024.'],
    })
    expect(describeFs(actionable(fs))).toEqual([])
  })

  test('“Anonymous Authors” 占位不报', async () => {
    const fs = await scanPaper({ authorLines: ['Anonymous Authors', 'Paper under double-blind review'] })
    expect(fs.filter((f) => f.ruleIds.includes('R03') || f.ruleIds.includes('R04'))).toEqual([])
  })

  test('AI 写作工具披露不报', async () => {
    const fs = await scanPaper({
      body: ['We used ChatGPT to polish the wording of this manuscript.', 'All technical content was written by the authors.'],
    })
    expect(describeFs(actionable(fs))).toEqual([])
  })

  test('RFC 2606 示例邮箱只作提示', async () => {
    const fs = await scanPaper({ body: ['Requests are sent to user@example.com in our simulator.'] })
    expect(fs.filter((f) => f.ruleIds.includes('R02') && f.severity === 'high')).toEqual([])
  })
})

describe('对照组：同一套版式下应当报警', () => {
  test('作者区真实姓名、机构与邮箱', async () => {
    const fs = await scanPaper({
      authorLines: ['Jordan Rivera', 'Example State University', 'jordan.rivera@cs.state-example.edu'],
      author: 'Jordan Rivera',
    })
    const rules = new Set(fs.filter((f) => f.severity === 'high').flatMap((f) => f.ruleIds))
    expect([...rules]).toEqual(expect.arrayContaining(['R01', 'R02', 'R04']))
  })

  test('第一人称自引 “In our previous work [3]”', async () => {
    const fs = await scanPaper({
      body: ['In our previous work [3], we introduced gadget priors.'],
      references: ['[3] J. Rivera. Gadget priors. 2024.'],
    })
    expect(fs.some((f) => f.ruleIds.includes('R08') && f.severity !== 'info')).toBe(true)
  })

  test('自定义词命中正文', async () => {
    const fs = await scanPaper({ body: ['We build on the GadgetForge toolkit developed in our lab.'] }, 'GadgetForge')
    expect(fs.some((f) => f.ruleIds.includes('R03') && f.matchedUserTerm)).toBe(true)
  })
})
