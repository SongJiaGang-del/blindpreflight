<script setup lang="ts">
import { NDrawer, NDrawerContent, NTabPane, NTabs } from 'naive-ui'
import { RULES } from '@/rules/engine'
import { PRESETS } from '@/presets'
import { DISCLAIMER } from '@/domain/labels'

const show = defineModel<boolean>('show', { required: true })
const tab = defineModel<string>('tab', { default: 'rules' })

const KEYS: Array<[string[], string]> = [
  [['J', '↓'], '下一条发现'],
  [['K', '↑'], '上一条发现'],
  [['Home'], '第一条发现'],
  [['R'], '把选中的发现标记为“已在源文件中修改”'],
  [['I'], '把选中的发现标记为“忽略：误报”'],
  [['U'], '把选中的发现恢复为待处理'],
  [['['], '同一发现的上一处出现'],
  [[']'], '同一发现的下一处出现'],
  [['←', '→'], '原页上一页 / 下一页'],
  [['+', '−'], '放大 / 缩小原页'],
  [['0'], '原页适应宽度'],
  [['?'], '打开本页'],
]

const IMPL: Record<string, string> = { implemented: '已按条款调整', partial: '部分实现', reference: '仅条款摘要' }

const FIXES: Array<[string, string]> = [
  ['元数据', 'LaTeX：在导言区加 \\hypersetup{pdfauthor={}, pdftitle={}}；Word：文件 → 信息 → 检查文档 → 删除文档属性和个人信息。再重新导出 PDF。'],
  ['作者区', '使用会场模板的匿名 / review 模式（如 \\usepackage[review]{acl}、\\documentclass[anonymous]{acmart}），不要手工删到只剩空行。'],
  ['致谢与资助', '投稿版整段删除或改为“Acknowledgments omitted for review”；资助编号同样删除，录用后再补回。'],
  ['代码与数据链接', '使用 anonymous.4open.science 等匿名托管，或在补充材料中提交压缩包；确认仓库提交记录、README、LICENSE 中没有姓名。'],
  ['自引', '把 “our previous work [3]” 改为 “Smith et al. [3] proposed …” 等第三人称写法；不要因此删掉必要的引用。'],
  ['超链接', '检查 \\href 的真实目标，不只是显示文字；hyperref 的 pdfauthor、链接到个人主页的脚注都要处理。'],
  ['页眉页脚', '去掉 “Preprint / Camera-ready / Under review at …” 等声明和 arXiv 侧边戳；使用会场提供的模板页眉。'],
  ['批注与附件', '在 PDF 阅读器中删除所有批注；导出时取消“包含附件”；用 “打印为 PDF” 也可以扁平化表单与批注。'],
  ['文件名', '上传前把文件改为中性名称，例如 paper.pdf、supplement.pdf。'],
]
</script>

<template>
  <n-drawer v-model:show="show" :width="'min(680px, 100vw)'" placement="right">
    <n-drawer-content title="帮助" closable :native-scrollbar="false">
      <n-tabs v-model:value="tab" type="line" animated>
        <n-tab-pane name="rules" tab="检查什么">
          <table class="t">
            <tbody>
              <tr v-for="r in RULES" :key="r.id">
                <td class="id">{{ r.id }}</td>
                <td><b>{{ r.title }}</b><div class="muted">{{ r.description }}</div></td>
              </tr>
            </tbody>
          </table>
          <h3>级别</h3>
          <ul>
            <li><b>高优先级</b>：几乎可以确定会暴露身份，应在源文件中修改。</li>
            <li><b>需核实</b>：可能暴露身份，需要你根据上下文判断。</li>
            <li><b>提示</b>：通常无害，但值得看一眼（如匿名仓库链接、普通第三方链接）。</li>
          </ul>
        </n-tab-pane>
        <n-tab-pane name="fix" tab="怎么修">
          <dl class="fix">
            <template v-for="[k, v] in FIXES" :key="k">
              <dt>{{ k }}</dt>
              <dd>{{ v }}</dd>
            </template>
          </dl>
          <p class="muted">修改源文件后重新导出 PDF，再回到本工具重新检查。同一组文件重新检查会保留你的复核标记。</p>
        </n-tab-pane>
        <n-tab-pane name="presets" tab="会场预设">
          <div v-for="p in PRESETS" :key="p.id" class="preset">
            <div><b>{{ p.venue }}{{ p.year ? ` ${p.year}` : '' }}</b> <span class="muted">· {{ IMPL[p.implementationStatus] }}{{ p.verifiedAt ? ` · 核验于 ${p.verifiedAt}` : '' }}</span></div>
            <ul>
              <li v-for="(x, i) in p.summary" :key="i">{{ x }}</li>
            </ul>
            <div v-for="(src, i) in p.sources" :key="i" class="src">
              {{ src.label }}<span v-if="src.section"> · {{ src.section }}</span>：<span class="url">{{ src.url }}</span>
            </div>
          </div>
          <p class="muted">网址仅作文本展示，请自行复制到浏览器核对。会场政策可能更新，请以官方页面为准。</p>
        </n-tab-pane>
        <n-tab-pane name="keys" tab="快捷键">
          <p class="muted">在结果页使用；光标在输入框或下拉菜单中时不生效。</p>
          <table class="t keys">
            <tbody>
              <tr v-for="[ks, d] in KEYS" :key="d">
                <td class="k"><template v-for="(k, i) in ks" :key="k"><kbd>{{ k }}</kbd><span v-if="i < ks.length - 1" class="muted"> / </span></template></td>
                <td>{{ d }}</td>
              </tr>
            </tbody>
          </table>
          <p class="muted">在原页上点击任意一个淡色框，可以跳到对应的发现。</p>
        </n-tab-pane>
        <n-tab-pane name="limits" tab="隐私与局限">
          <h3>隐私</h3>
          <ul>
            <li>PDF 只在当前标签页的内存中解析，不上传、不缓存到磁盘；关闭或刷新页面即清除。</li>
            <li>页面的内容安全策略禁止向其他站点发起请求；不使用云端 AI、统计或第三方字体。</li>
            <li>只有会场预设、亮 / 暗主题、OCR 开关和自定义预设的规则设置会保存在本机浏览器（localStorage），不包含任何稿件内容。</li>
            <li>本地 OCR 的识别组件与语言包从本站加载，识别在浏览器里完成。离线缓存（service worker）只保存本站的静态资源，不保存稿件。</li>
            <li>报告默认脱敏、隐藏文件名，并在下载前提示可能含有身份信息。</li>
          </ul>
          <h3>检查不到的内容</h3>
          <ul>
            <li>文字正常的页面里的插图、图表与截图中的文字（本地 OCR 只识别扫描页 / 图片页）；PNG 等非 JPEG 图片内嵌的元数据。</li>
            <li>白色文字、被遮挡文字、隐藏图层（OCG），以及增量保存旧版本的正文与批注（旧版本的元数据会检查）。</li>
            <li>外部链接指向的网站内容（工具不访问任何链接）。</li>
            <li>补充视频与数据文件的内容；源文件包只检查文本、注释、文档属性与图片元数据。</li>
            <li>写作风格、实验设置等需要领域知识才能判断的隐式身份线索。</li>
          </ul>
          <p class="disclaimer">{{ DISCLAIMER }}</p>
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
