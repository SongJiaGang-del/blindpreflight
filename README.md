# BlindPreflight

双盲投稿 PDF 的**本地**匿名自检工具：在浏览器里打开主稿（以及至多 2 份补充材料），找出可能暴露作者身份的地方，每条发现都带页码与原页高亮框，可导出脱敏的 JSON / 可打印 HTML 报告。

> 稿件从不离开你的电脑：没有上传、没有云端 AI、没有统计脚本。详见 [docs/能力边界.md](docs/能力边界.md)。

## 能检查什么

| 规则 | 内容 |
|---|---|
| R01 | PDF 元数据（Author / Creator / Producer / XMP 等） |
| R02 | 邮箱（含 `{alice,bob}@example.edu` 分组写法） |
| R03 | 姓名与自定义词（你填写的作者名、系统名、项目代号等） |
| R04 | 机构 / 院系 / 实验室（中英文） |
| R05 | 致谢段落（按会场政策区分“禁止 / 仅 AI 声明 / 不得含身份”） |
| R06 | 资助与基金号 |
| R07 | 正文网址：代码仓库、个人 / 机构主页、云盘、视频等 |
| R08 | 第一人称自引（“our previous work”“我们此前提出”） |
| R09 | 隐含身份（“our lab”“我校”等） |
| R10 | 内嵌超链接（真实目标与可见文字分别检查） |
| R11 | 页眉页脚、arXiv 版本戳、camera-ready 残留 |
| R12 | 文件名 |
| R13 | 批注（含作者 / 账户字段）与编辑残留（TODO、FIXME、作者回复等） |
| R15 | ORCID、本机路径（`C:\Users\…`、`/home/…`） |
| R17 | PDF 附件 |

此外会报告**覆盖情况**：哪些页文字过少（疑似扫描 / 图片页）、哪些内容没被检查。

## 修复工作流

- **清理版 PDF**：在本机用 pdf-lib 删除元数据 / XMP、审阅批注、嵌入附件（可选：外部链接目标、标题），并回收增量更新留下的残留对象；随后用相同设置复检，告诉你哪些问题已消除、哪些仍要改源文件。正文内容不改动。
- **修复前后对比**：在结果页“上传新版本”或“替换并重新检查”后，自动与上一版对比，分为已修复 / 仍存在 / 新增；忽略类复核决定沿用，标记为“已修改”却仍存在的会恢复为待处理。
- **人工核对清单**：匿名仓库、图片中的文字、补充材料、第三人称自引、预印本政策等规则查不到的事项，按会场预设调整说明，勾选情况可写入报告。

## 会场预设

| 预设 | 状态 |
|---|---|
| 通用双盲 | 已实现 |
| ACL Rolling Review (ARR) | 已实现 |
| NeurIPS 2026 | 已实现（致谢禁止、资助升为高危） |
| ICLR 2026 | 已实现 |
| MobiCom 2026 | 部分实现（所有内嵌链接都提示） |
| CVPR 2026 / USENIX Security 2026 / CCS 2026 | 仅条款摘要，检查按通用规则执行 |

条款核验于 2026-11-09，链接见应用内“预设卡片”。**以会场官方页面为准**。

## 运行

需要 Node.js ≥ 22.13。

```powershell
npm install
```

```powershell
npm run dev
```

`npm install` 会通过 postinstall 把 pdf.js 的 worker、cmaps、字体和 wasm 复制到 `public/pdfjs/`（已在 .gitignore 中），保证运行时只读同源资源。

构建出的 `dist/` 使用相对路径（`base: './'`），可放到任意静态托管或本地目录。

```powershell
npm run build
```

## 测试

```powershell
npm run lint
```

```powershell
npm run typecheck
```

```powershell
npm test
```

单元测试用 Node 版 pdf.js 解析 `public/samples/` 下的合成样例，覆盖规则命中、坐标、误报抑制和报告脱敏 / 转义。

### 端到端（Playwright）

E2E 会先 `vite build`，再在 `127.0.0.1:4173` 上预览，并拦截一切非本机请求作为“断网金丝雀”。

如果本机已有可用的 Chromium headless shell，可通过环境变量指定，免去下载：

```powershell
$env:PW_CHROMIUM_PATH = "<chrome-headless-shell.exe 的完整路径>"; npm run test:e2e
```

否则先安装 Playwright 自带的浏览器（会下载约 100 MB）：

```powershell
npx playwright install chromium
```

### 样例 PDF

`public/samples/` 中的三份 PDF 由 `scripts/make-fixtures.ts` 用 pdf-lib 生成，**全部内容虚构**（Alex Example、example.edu 等），只使用 PDF 标准字体，不嵌入任何系统字体：

- `sample-leaky.pdf`：故意留下各类泄露；
- `sample-fixed.pdf`：修复后的版本；
- `sample-supplement.pdf`：带泄露的补充材料。

```powershell
npm run fixtures
```

## 目录

```
src/
  parsers/pdf/   pdf.js 提取：文字项、坐标、元数据、链接、批注、附件
  normalize/     行与区域（作者区 / 页眉页脚 / 致谢 / 参考文献 / 附录）、Unicode 规范化、多视图文本
  rules/         各条规则与引擎
  presets/       会场预设
  report/        报告构建（脱敏）、HTML 渲染（全转义 + CSP）、下载
  clean/         清理版 PDF（pdf-lib，按需加载）
  app/           会话状态、主题、修复前后对比、人工核对清单
  components/    Vue + Naive UI 界面
tests/           Vitest
e2e/             Playwright
scripts/         样例生成、pdf.js 资源复制
```

## 隐私约束（开发者须知）

- ESLint 禁止应用代码使用 `fetch`、XHR、WebSocket、`sendBeacon`；唯一例外是读取同源的示例 PDF。
- `index.html` 的 CSP 限定 `connect-src 'self'`、`form-action 'none'`、`frame-src 'none'`。
- 不使用 `v-html`；所有稿件文字以纯文本渲染，双向控制字符可视化为 `⟨U+202E⟩`。
- localStorage 只存界面偏好，不存稿件、文件名、自定义词或结果。
