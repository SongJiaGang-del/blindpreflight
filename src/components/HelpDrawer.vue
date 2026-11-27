<script setup lang="ts">
import { NDrawer, NDrawerContent, NTabPane, NTabs } from 'naive-ui'
import { RULES } from '@/rules/engine'
import { PRESETS, presetName } from '@/presets'
import { DISCLAIMER } from '@/domain/labels'
import { L, type Text } from '@/domain/text'
import { useI18n } from '@/i18n'

const show = defineModel<boolean>('show', { required: true })
const tab = defineModel<string>('tab', { default: 'rules' })
const { t, tx, locale } = useI18n()

const KEYS: Array<[string[], Text]> = [
  [['J', '↓'], L('下一条发现', 'Next finding')],
  [['K', '↑'], L('上一条发现', 'Previous finding')],
  [['Home'], L('第一条发现', 'First finding')],
  [['R'], L('把选中的发现标记为“已在源文件中修改”', 'Mark the selected finding as “fixed in the source”')],
  [['I'], L('把选中的发现标记为“忽略：误报”', 'Mark the selected finding as “dismissed: false positive”')],
  [['U'], L('把选中的发现恢复为待处理', 'Reopen the selected finding')],
  [['['], L('同一发现的上一处出现', 'Previous occurrence of the same finding')],
  [[']'], L('同一发现的下一处出现', 'Next occurrence of the same finding')],
  [['←', '→'], L('原页上一页 / 下一页', 'Previous / next page')],
  [['+', '−'], L('放大 / 缩小原页', 'Zoom the page in / out')],
  [['0'], L('原页适应宽度', 'Fit the page to width')],
  [['?'], L('打开本页', 'Open this panel')],
]

const FIXES: Array<[Text, Text]> = [
  [
    L('元数据', 'Metadata'),
    L(
      String.raw`LaTeX：在导言区加 \hypersetup{pdfauthor={}, pdftitle={}}；Word：文件 → 信息 → 检查文档 → 删除文档属性和个人信息。再重新导出 PDF。`,
      String.raw`LaTeX: add \hypersetup{pdfauthor={}, pdftitle={}} to the preamble; Word: File → Info → Inspect Document → remove document properties and personal information. Then export the PDF again.`,
    ),
  ],
  [
    L('作者区', 'Author block'),
    L(
      String.raw`使用会场模板的匿名 / review 模式（如 \usepackage[review]{acl}、\documentclass[anonymous]{acmart}），不要手工删到只剩空行。`,
      String.raw`Use the template’s anonymous / review mode (e.g. \usepackage[review]{acl}, \documentclass[anonymous]{acmart}) instead of deleting lines by hand.`,
    ),
  ],
  [
    L('致谢与资助', 'Acknowledgments and funding'),
    L(
      '投稿版整段删除或改为“Acknowledgments omitted for review”；资助编号同样删除，录用后再补回。',
      'Remove the section in the submission or replace it with “Acknowledgments omitted for review”; remove grant numbers too and restore them after acceptance.',
    ),
  ],
  [
    L('代码与数据链接', 'Code and data links'),
    L(
      '使用 anonymous.4open.science 等匿名托管，或在补充材料中提交压缩包；确认仓库提交记录、README、LICENSE 中没有姓名。',
      'Use anonymous hosting such as anonymous.4open.science, or ship an archive as supplementary material; make sure commit history, README and LICENSE contain no names.',
    ),
  ],
  [
    L('自引', 'Self-citation'),
    L(
      '把 “our previous work [3]” 改为 “Smith et al. [3] proposed …” 等第三人称写法；不要因此删掉必要的引用。',
      'Rewrite “our previous work [3]” in the third person, e.g. “Smith et al. [3] proposed …”; do not drop necessary citations.',
    ),
  ],
  [
    L('超链接', 'Hyperlinks'),
    L(
      String.raw`检查 \href 的真实目标，不只是显示文字；hyperref 的 pdfauthor、链接到个人主页的脚注都要处理。`,
      String.raw`Check the real target of every \href, not just its text; also handle hyperref’s pdfauthor and footnotes linking to personal pages.`,
    ),
  ],
  [
    L('页眉页脚', 'Headers and footers'),
    L(
      '去掉 “Preprint / Camera-ready / Under review at …” 等声明和 arXiv 侧边戳；使用会场提供的模板页眉。',
      'Remove “Preprint / Camera-ready / Under review at …” notices and arXiv side stamps; use the venue template’s header.',
    ),
  ],
  [
    L('批注与附件', 'Annotations and attachments'),
    L(
      '在 PDF 阅读器中删除所有批注；导出时取消“包含附件”；用 “打印为 PDF” 也可以扁平化表单与批注。',
      'Delete all annotations in your PDF reader and turn off “include attachments” when exporting; “Print to PDF” also flattens forms and annotations.',
    ),
  ],
  [L('文件名', 'File names'), L('上传前把文件改为中性名称，例如 paper.pdf、supplement.pdf。', 'Rename files to something neutral before uploading, e.g. paper.pdf, supplement.pdf.')],
]

const LEVELS: Array<[string, Text]> = [
  ['sev.high', L('几乎可以确定会暴露身份，应在源文件中修改。', 'Almost certainly reveals your identity; fix it in the source.')],
  ['sev.medium', L('可能暴露身份，需要你根据上下文判断。', 'May reveal your identity; judge from the context.')],
  ['sev.info', L('通常无害，但值得看一眼（如匿名仓库链接、普通第三方链接）。', 'Usually harmless but worth a look (e.g. anonymous repository or ordinary third-party links).')],
]

const PRIVACY: Text[] = [
  L('PDF 只在当前标签页的内存中解析，不上传、不缓存到磁盘；关闭或刷新页面即清除。', 'PDFs are parsed only in this tab’s memory — never uploaded or written to disk — and are gone when you close or reload the page.'),
  L('页面的内容安全策略禁止向其他站点发起请求；不使用云端 AI、统计或第三方字体。', 'The page’s Content Security Policy blocks requests to other sites; no cloud AI, analytics or third-party fonts.'),
  L(
    '只有会场预设、亮 / 暗主题、界面语言、OCR 开关和自定义预设的规则设置会保存在本机浏览器（localStorage），不包含任何稿件内容。',
    'Only your venue preset, theme, interface language, OCR switch and custom preset rule settings are stored in this browser (localStorage) — never any manuscript content.',
  ),
  L(
    '本地 OCR 的识别组件与语言包从本站加载，识别在浏览器里完成。离线缓存（service worker）只保存本站的静态资源，不保存稿件。',
    'The local OCR engine and language data load from this site and run in the browser. The offline cache (service worker) stores only this site’s static files, never manuscripts.',
  ),
  L('报告默认脱敏、隐藏文件名，并在下载前提示可能含有身份信息。', 'Reports are redacted with file names hidden by default, and you are warned before downloading anything identifying.'),
]

const LIMITS: Text[] = [
  L(
    '文字正常的页面里的插图、图表与截图中的文字（本地 OCR 只识别扫描页 / 图片页）；PNG 等非 JPEG 图片内嵌的元数据。',
    'Text inside figures, charts and screenshots on normal pages (local OCR only reads scanned / image pages); metadata embedded in non-JPEG images such as PNG.',
  ),
  L(
    '白色文字、被遮挡文字、隐藏图层（OCG），以及增量保存旧版本的正文与批注（旧版本的元数据会检查）。',
    'White or hidden text, optional content layers (OCG), and the text and annotations of earlier saved revisions (their metadata is checked).',
  ),
  L('外部链接指向的网站内容（工具不访问任何链接）。', 'The content of websites that links point to (links are never visited).'),
  L('补充视频与数据文件的内容；源文件包只检查文本、注释、文档属性与图片元数据。', 'The content of supplementary videos and data files; source archives are checked only for text, comments, document properties and image metadata.'),
  L('写作风格、实验设置等需要领域知识才能判断的隐式身份线索。', 'Implicit identity clues such as writing style or experimental setup that need domain knowledge to judge.'),
]
</script>

<template>
  <n-drawer v-model:show="show" :width="'min(680px, 100vw)'" placement="right">
    <n-drawer-content :title="t('help.title')" closable :native-scrollbar="false">
      <n-tabs v-model:value="tab" type="line" animated>
        <n-tab-pane name="rules" :tab="t('help.tabRules')">
          <table class="t">
            <tbody>
              <tr v-for="r in RULES" :key="r.id">
                <td class="id">{{ r.id }}</td>
                <td><b>{{ tx(r.title) }}</b><div class="muted">{{ tx(r.description) }}</div></td>
              </tr>
            </tbody>
          </table>
          <h3>{{ t('help.levels') }}</h3>
          <ul>
            <li v-for="[k, d] in LEVELS" :key="k"><b>{{ t(k) }}</b>: {{ tx(d) }}</li>
          </ul>
        </n-tab-pane>
        <n-tab-pane name="fix" :tab="t('help.tabFix')">
          <dl class="fix">
            <template v-for="([k, v], i) in FIXES" :key="i">
              <dt>{{ tx(k) }}</dt>
              <dd>{{ tx(v) }}</dd>
            </template>
          </dl>
          <p class="muted">{{ t('help.fixNote') }}</p>
        </n-tab-pane>
        <n-tab-pane name="presets" :tab="t('help.tabPresets')">
          <div v-for="p in PRESETS" :key="p.id" class="preset">
            <div>
              <b>{{ presetName(p, locale) }}</b>
              <span class="muted">
                · {{ t(`preset.impl.${p.implementationStatus}`) }}{{ p.verifiedAt ? ` · ${t('help.verified', { d: p.verifiedAt })}` : '' }}
              </span>
            </div>
            <ul>
              <li v-for="(x, i) in p.summary" :key="i">{{ tx(x) }}</li>
            </ul>
            <div v-for="(src, i) in p.sources" :key="i" class="src">
              {{ src.label }}<span v-if="src.section"> · {{ src.section }}</span>: <span class="url">{{ src.url }}</span>
            </div>
          </div>
          <p class="muted">{{ t('help.presetsNote') }}</p>
        </n-tab-pane>
        <n-tab-pane name="keys" :tab="t('help.tabKeys')">
          <p class="muted">{{ t('help.keysNote') }}</p>
          <table class="t keys">
            <tbody>
              <tr v-for="([ks, d], i) in KEYS" :key="i">
                <td class="k"><template v-for="(k, j) in ks" :key="k"><kbd>{{ k }}</kbd><span v-if="j < ks.length - 1" class="muted"> / </span></template></td>
                <td>{{ tx(d) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="muted">{{ t('help.keysBoxes') }}</p>
        </n-tab-pane>
        <n-tab-pane name="limits" :tab="t('help.tabLimits')">
          <h3>{{ t('help.privacy') }}</h3>
          <ul>
            <li v-for="(x, i) in PRIVACY" :key="i">{{ tx(x) }}</li>
          </ul>
          <h3>{{ t('help.cannot') }}</h3>
          <ul>
            <li v-for="(x, i) in LIMITS" :key="i">{{ tx(x) }}</li>
          </ul>
          <p class="disclaimer">{{ tx(DISCLAIMER) }}</p>
        </n-tab-pane>
      </n-tabs>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.t {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
.t td {
  border-top: 1px solid var(--bp-line);
  padding: 6px;
  vertical-align: top;
}
.id {
  font-family: ui-monospace, Consolas, monospace;
  color: var(--bp-muted);
  width: 44px;
}
.muted {
  color: var(--bp-muted);
  font-size: 12px;
}
.keys .k {
  white-space: nowrap;
  width: 120px;
}
h3 {
  font-family: var(--bp-serif);
  font-size: 15px;
  margin: 16px 0 6px;
}
ul {
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.65;
}
.fix dt {
  font-weight: 600;
  margin-top: 10px;
}
.fix dd {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 1.6;
}
.preset {
  border-top: 1px solid var(--bp-line);
  padding: 10px 0;
  font-size: 13px;
}
.preset ul {
  margin: 4px 0;
}
.src {
  font-size: 12px;
  color: var(--bp-muted);
}
.url {
  font-family: ui-monospace, Consolas, monospace;
  word-break: break-all;
  user-select: all;
}
.disclaimer {
  font-size: 12px;
  background: var(--bp-panel-2);
  border-left: 3px solid var(--bp-line-strong);
  padding: 10px;
  border-radius: 6px;
}
</style>
