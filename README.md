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
| R18 | 嵌入图片的 EXIF / IPTC / XMP（作者、版权、设备序列号、GPS 位置），含未被页面引用的残留图片 |
| R19 | 字体名中的作者名、自定义词或机构词 |
| R20 | 增量保存的旧版本：残留的旧元数据（如改稿前的作者名）与保存版本数 |
| R21 | 会场审稿模板标记（CVPR、ICLR、CCS 等预设） |
| R22 | 源文件包：`\author`、`\thanks`、`\affiliation`、`pdfauthor`、终稿开关（如 `[final]{neurips_2026}`） |
| R23 | 源文件包：LaTeX 注释、`\iffalse` / `comment` 块，以及代码 / 说明文件里的姓名、邮箱、本机路径、个人仓库、版权人 |
| R24 | 源文件包：`.git` 等版本库目录、编译日志 / synctex 里的本机路径、临时文件 |
| R25 | 源文件包：图片 EXIF / PNG 文本、Office 文档属性、含姓名的文件名 |

此外会报告**覆盖情况**：哪些页文字过少（疑似扫描 / 图片页）、哪些内容没被检查。

## 修复工作流

- **清理版 PDF**：在本机用 pdf-lib 删除元数据 / XMP、审阅批注、嵌入附件、图片的 EXIF / IPTC / XMP（可选：外部链接目标、标题），把增量保存合并为单一版本并回收残留对象；随后用相同设置复检，告诉你哪些问题已消除、哪些仍要改源文件。正文内容不改动。
- **修复前后对比**：在结果页“上传新版本”或“替换并重新检查”后，自动与上一版对比，分为已修复 / 仍存在 / 新增；忽略类复核决定沿用，标记为“已修改”却仍存在的会恢复为待处理。
- **人工核对清单**：匿名仓库、图片中的文字、补充材料、第三人称自引、预印本政策等规则查不到的事项，按会场预设调整说明，勾选情况可写入报告。

## 源文件、扫描页与离线使用

- **源文件包**：可选导入 LaTeX 工程或代码的 `.zip`（或单个 `.tex`）。在内存中解压（最多 50 MB / 解压后 300 MB / 5000 个文件），检查 PDF 里看不到、但随 arXiv 源码或补充材料公开的内容；`\author` 中的姓名也会用于检查 PDF 正文。
- **本地 OCR**：可选开启。只识别文字缺失或乱码的页面（扫描页、图片页），一次最多 40 页；识别组件与英文 / 简体中文语言包都从本站加载，在浏览器里完成。OCR 得到的命中会注明“可能有识别错误”。
- **中文 / English**：页眉右上角切换界面语言，首次打开按浏览器语言选择。每条发现的原因和修改建议在检查时就同时生成中英文，切换语言不需要重新检查；导出的报告使用当前界面语言。
- **离线安装**：构建产物带 service worker 与清单，可以安装到桌面并断网使用。service worker 只缓存本站静态资源；OCR 组件在第一次使用时缓存。

## 会场预设

| 预设 | 状态 |
|---|---|
| 通用双盲 | 已实现 |
| ACL Rolling Review (ARR) | 已实现 |
| NeurIPS 2026 | 已实现（致谢禁止、资助升为高危） |
| ICLR 2026 | 已实现（含审稿模板标记） |
| CVPR 2026 | 已实现（致谢禁止、资助升为高危、审稿模板标记） |
| USENIX Security 2026 | 已实现（致谢禁止、资助升为高危） |
| ACM CCS 2026 | 已实现（致谢禁止、资助升为高危、acmart 匿名标记） |
| MobiCom 2026 | 部分实现（所有内嵌链接都提示） |
| 自定义预设 | 在内置预设基础上调整致谢政策、外链提示、规则级别与模板标记；保存在本机，可导出 / 导入 JSON |

条款核验于 2026-11-09，链接见应用内“预设卡片”。**以会场官方页面为准**。

## 运行

需要 Node.js ≥ 22.13。

```powershell
npm install
```

```powershell
npm run dev
```

`npm install` 会通过 postinstall 把 pdf.js 的 cmaps、字体、wasm 复制到 `public/pdfjs/`，把 OCR 的 worker、内核和英文 / 简体中文语言包（约 16 MB）复制到 `public/ocr/`（都已在 .gitignore 中），保证运行时只读同源资源。

PWA 图标由 `node scripts/make-icons.mjs` 生成（已提交在 `public/icons/`）；`dist/sw.js` 在构建时生成。

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
  ocr/           本地 OCR（tesseract.js，按需加载）
  app/           会话状态、主题、修复前后对比、人工核对清单、PWA 注册
  components/    Vue + Naive UI 界面
tests/           Vitest
e2e/             Playwright
scripts/         样例生成、pdf.js 资源复制
```

## 隐私约束（开发者须知）

- ESLint 禁止应用代码使用 `fetch`、XHR、WebSocket、`sendBeacon`；唯一例外是读取同源的示例 PDF。
- `index.html` 的 CSP 限定 `connect-src 'self'`、`form-action 'none'`、`frame-src 'none'`。
- 不使用 `v-html`；所有稿件文字以纯文本渲染，双向控制字符可视化为 `⟨U+202E⟩`。
- localStorage 只存界面偏好（会场预设、主题、界面语言、OCR 开关）和自定义预设的规则设置，不存稿件、文件名、自定义词或结果。
- 界面文字在 `src/i18n/zh.ts` / `en.ts`；规则产出的说明用 `src/domain/text.ts` 的 `L(中文, English)` 同时给出两种语言。
