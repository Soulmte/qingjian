<h1 align="center">青简</h1>

<p align="center"><strong>本地优先的 Markdown 编辑器</strong><br><sub>编码之外，留一处安静写字的地方</sub></p>

<p align="center">
<a href="https://github.com/Soulmte/qingjian/releases/latest"><img src="https://img.shields.io/github/v/release/Soulmte/qingjian?color=4a7c59&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC" alt="最新版本"></a>
<img src="https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows%2010%20%2F%2011%20x64-4a7c59" alt="平台">
<img src="https://img.shields.io/badge/%E6%A1%86%E6%9E%B6-Tauri%202-4a7c59" alt="框架">
<a href="https://github.com/Soulmte/qingjian/actions/workflows/release.yml"><img src="https://github.com/Soulmte/qingjian/actions/workflows/release.yml/badge.svg" alt="构建状态"></a>
</p>

<h2>青简是什么</h2>

<p>一个装在 Windows 上的 Markdown 编辑器。<strong>你的笔记是磁盘上普通的 <code>.md</code> 文件</strong>，不是某个应用的数据库记录——换台电脑、换个编辑器、甚至删掉青简，文件都还在，还能被任何工具打开。</p>

<p>写的时候是「所见即所得」：Markdown 语法在行内直接成形，标题就是标题的样子，表格就是表格的样子，不用在「源码」和「预览」两个窗口之间来回跳。想核对原始语法时，<kbd>Ctrl</kbd>+<kbd>/</kbd> 一键切到源码模式。</p>

<h3>它与众不同的地方</h3>

<ul>
<li><strong>数据是自己的</strong>：正文始终是你选的目录里的 Markdown 文件；SQLite 只放元数据、标签和搜索索引，删了可以重建。</li>
<li><strong>不联网也能用</strong>：全功能离线可用。联网只发生在两件事上——你主动把图片传到图床，以及检查更新。</li>
<li><strong>对中文认真</strong>：全文检索用 FTS5 做逐字索引（不依赖分词），GB18030 编码的老文件能正确读入，导出 Word 时公式转成 Word 原生 OMML 而不是图片。</li>
<li><strong>六套强调色</strong>：竹青 / 墨蓝 / 胭脂 / 赭石 / 黛紫 / 苍碧，每套都有明暗两式，整块画布换色而不只是按钮换色。</li>
</ul>

<h2>功能</h2>

<h3>写作</h3>

<ul>
<li>所见即所得编辑，基于 Milkdown（ProseMirror）</li>
<li>源码模式对照原始 Markdown（<kbd>Ctrl</kbd>+<kbd>/</kbd>）</li>
<li>专注模式（<kbd>F8</kbd>）只高亮当前段落，其余淡出</li>
<li>打字机模式（<kbd>F9</kbd>）光标所在行始终停在屏幕中央</li>
<li>标题、加粗、斜体、删除线、行内代码、引用、分割线、代码块（带高亮）</li>
<li>有序 / 无序 / 任务列表，支持多级缩进</li>
<li>表格：增删行列、列对齐</li>
<li>数学公式：行内 <code>$...$</code> 与块级 <code>$$...$$</code>，KaTeX 渲染</li>
<li>图片：拖动、粘贴、等比例缩放、左中右对齐、可选图注</li>
<li>段落与标题同样支持左 / 中 / 右对齐（导出时保留）</li>
</ul>

<h3>查找与导航</h3>

<ul>
<li>查找 / 替换，支持上一个下一个定位（<kbd>Ctrl</kbd>+<kbd>F</kbd> / <kbd>Ctrl</kbd>+<kbd>H</kbd>）</li>
<li>大纲面板，点标题即跳</li>
<li>快速打开：按文件名模糊搜索并打开笔记（<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>）</li>
<li>跳转到标题，源码模式下还能直接输入行号（<kbd>Ctrl</kbd>+<kbd>G</kbd>）</li>
<li>命令面板（<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>），所有命令可搜</li>
<li>全文检索：跨笔记搜索内容，中文逐字匹配</li>
<li>右键菜单、多级子菜单</li>
</ul>

<h3>外观</h3>

<ul>
<li>六套强调色 × 明暗两式，跟随系统或手动指定</li>
<li>界面字体、正文字体从系统已装字体里选（带搜索的字体选择器）</li>
<li>正文字号、行高、编辑区宽度可调</li>
<li>六种代码底色：云白 / 暖沙 / 青瓷 / 石墨 / 墨玉 / 深空</li>
<li>界面圆角与整体缩放可调</li>
</ul>

<h3>导出</h3>

<ul>
<li><strong>Word（.docx）</strong>：可分别为一至六级标题指定字体、字号、加粗与颜色；代码块、表格、图片样式均可配置；<strong>公式转成 Word 原生 OMML</strong>，在 Word 里可以继续编辑；页边距与纸张尺寸可选</li>
<li><strong>PDF</strong>：走 WebView2 自己的打印管线（没有页眉页脚，静默输出），中文不会缺字</li>
<li>HTML、纯文本、Markdown 源文件</li>
<li>导出前可选目标格式，不悄悄按默认格式写盘</li>
</ul>

<h3>图片与图床</h3>

<ul>
<li>默认存在工作区内的目录（默认 <code>assets/</code>），插入时自动引用相对路径</li>
<li>也可以上传到 <strong>GitHub 或 Gitee</strong> 仓库当图床，插入的是可公开访问的直链</li>
<li>剪贴板里的图片直接粘贴即可落盘或上传</li>
<li>访问令牌保存在 SQLite 的 <code>secret</code> 表里，<strong>只在 Rust 侧使用，不会进入前端</strong></li>
<li>上传前可先「测试连接」，确认仓库与分支可达再写入</li>
</ul>

<h3>安全与更新</h3>

<ul>
<li>换窗口聚焦时若文件被外部程序改过，保存会被拦下并给出「保留我的版本 / 重新载入文件」的选择，不会静默覆盖</li>
<li>删除笔记走系统回收站，不是直接抹掉</li>
<li>启动时可自动检查新版本，发现新版本弹窗提示并可一键下载安装包</li>
</ul>

<h2>下载与安装</h2>

<table>
<thead><tr><th align="left">安装包</th><th align="left">适用场景</th><th align="left">说明</th></tr></thead>
<tbody>
<tr><td><code>Qingjian_x.y.z_x64-setup.exe</code></td><td>绝大多数人</td><td>单文件安装包（NSIS），双击按提示走完即可</td></tr>
<tr><td><code>Qingjian_x.y.z_x64_zh-CN.msi</code></td><td>需要静默部署</td><td>可用 <code>msiexec /i 包名.msi /qn</code> 批量安装</td></tr>
</tbody>
</table>

<p>到 <a href="https://github.com/Soulmte/qingjian/releases/latest">Releases</a> 页面下载最新版本（Gitee 同步发布，见文末）。</p>

<p><strong>系统要求</strong>：Windows 10 / 11 64 位。界面由 WebView2 渲染，Windows 11 自带；Windows 10 若没有，安装包会自动下载安装（这一步需要联网）。</p>

<h2>数据存在哪里</h2>

<table>
<thead><tr><th align="left">内容</th><th align="left">位置</th><th align="left">说明</th></tr></thead>
<tbody>
<tr><td>笔记正文</td><td>你选择的工作区目录，如 <code>D:\notes\xxx.md</code></td><td><strong>唯一的权威副本</strong>，随时可用别的编辑器打开</td></tr>
<tr><td>元数据、标签、搜索索引、设置</td><td><code>%APPDATA%\com.soulmte.qingjian\qingjian.db</code></td><td>SQLite。删掉只会丢索引与设置，重新打开工作区即可重建</td></tr>
<tr><td>图床令牌</td><td>同上，<code>secret</code> 表</td><td>不写入任何日志或导出文件</td></tr>
</tbody>
</table>

<h2>快捷键</h2>

<p>共 <strong>54 项可用</strong>，另有 4 项未实现（下表已注明原因）。这一页与应用的「设置 → 快捷键」由同一份数据渲染，不存在文档写了而程序没接的情况——有测试盯着这条契约。</p>

<h3>文件操作</h3>

<table>
<thead><tr><th align="left">快捷键</th><th align="left">功能</th><th align="left">说明</th></tr></thead>
<tbody>
<tr><td><kbd>Ctrl</kbd>+<kbd>N</kbd></td><td>新建文件</td><td></td></tr>
<tr><td><kbd>F2</kbd></td><td>重命名当前笔记</td><td>重命名时可同时移动到其它文件夹</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd></td><td>新建窗口</td><td>所有窗口共用同一个工作区数据库</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>O</kbd></td><td>打开文件</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd></td><td>快速打开（搜索并打开笔记）</td><td>原键位 <kbd>Ctrl</kbd>+<kbd>P</kbd> 与「打印」冲突，改用此键</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>保存文件</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></td><td>另存为 / 导出</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>P</kbd></td><td>打印</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>W</kbd></td><td>关闭文件</td><td></td></tr>
</tbody>
</table>

<h3>编辑操作</h3>

<table>
<thead><tr><th align="left">快捷键</th><th align="left">功能</th><th align="left">说明</th></tr></thead>
<tbody>
<tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td><td>撤销</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Y</kbd> 或 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>重做</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>X</kbd></td><td>剪切</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>C</kbd></td><td>复制</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>V</kbd></td><td>粘贴</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd></td><td>粘贴为纯文本</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>查找</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>H</kbd></td><td>替换</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>A</kbd></td><td>全选</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>L</kbd></td><td>选中当前行</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd></td><td>删除当前行</td><td>原键位 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> 与「插入代码块」冲突，改用此键</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>插入链接</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd></td><td>插入图片</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>T</kbd></td><td>插入表格</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd></td><td>插入代码块</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd></td><td>插入数学公式</td><td></td></tr>
</tbody>
</table>

<h3>格式设置</h3>

<table>
<thead><tr><th align="left">快捷键</th><th align="left">功能</th><th align="left">说明</th></tr></thead>
<tbody>
<tr><td><kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>6</kbd></td><td>标题 1–6 级</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>0</kbd></td><td>段落格式</td><td>取消标题，恢复为普通段落</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>B</kbd></td><td>加粗</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>I</kbd></td><td>斜体</td><td></td></tr>
<tr><td><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>5</kbd></td><td>删除线</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd></td><td>行内代码</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>]</kbd></td><td>无序列表</td><td>也可用 <code>*</code> + 空格</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>[</kbd></td><td>有序列表</td><td>也可用 数字 + <code>.</code> + 空格</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd></td><td>任务列表</td><td>插入 <code>- [ ]</code></td></tr>
<tr><td><kbd>Tab</kbd></td><td>缩进</td><td>列表内生效</td></tr>
<tr><td><kbd>Shift</kbd>+<kbd>Tab</kbd></td><td>取消缩进</td><td>列表内生效</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td><td>居中对齐</td><td>作用于当前段落 / 标题 / 图片；光标在表格里时作用于表格列</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd></td><td>右对齐</td><td>同上</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>\</kbd></td><td>清除格式</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>U</kbd></td><td>下划线</td><td><sub>未实现</sub> Markdown 没有下划线语法，只能写内联 HTML</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd></td><td>左对齐</td><td><sub>未实现</sub> 该键位归了「显示 / 隐藏侧边栏」；左对齐请用顶部工具栏的对齐按钮</td></tr>
</tbody>
</table>

<h3>视图操作</h3>

<table>
<thead><tr><th align="left">快捷键</th><th align="left">功能</th><th align="left">说明</th></tr></thead>
<tbody>
<tr><td><kbd>Ctrl</kbd>+<kbd>/</kbd></td><td>切换源代码模式</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>G</kbd></td><td>跳转到标题</td><td>源代码模式下也可输入行号</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd></td><td>显示 / 隐藏侧边栏</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd></td><td>大纲视图</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>2</kbd></td><td>文件列表</td><td><sub>未实现</sub> 本应用只有一个文件面板，从侧边栏切换即可</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>3</kbd></td><td>文件树</td><td><sub>未实现</sub> 与「文件列表」是同一个面板</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>=</kbd></td><td>放大</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>-</kbd></td><td>缩小</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>0</kbd></td><td>恢复默认缩放</td><td></td></tr>
<tr><td><kbd>F8</kbd></td><td>专注模式</td><td>只高亮当前段落</td></tr>
<tr><td><kbd>F9</kbd></td><td>打字机模式</td><td>当前行始终居中</td></tr>
<tr><td><kbd>F11</kbd></td><td>全屏模式</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd></td><td>切换夜间模式</td><td>原键位 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> 已给「新建窗口」</td></tr>
</tbody>
</table>

<h3>其他</h3>

<table>
<thead><tr><th align="left">快捷键</th><th align="left">功能</th><th align="left">说明</th></tr></thead>
<tbody>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd></td><td>命令面板</td><td></td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>,</kbd></td><td>打开偏好设置</td><td></td></tr>
<tr><td><kbd>F1</kbd></td><td>打开帮助</td><td>即快捷键说明页</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Q</kbd></td><td>关闭应用</td><td></td></tr>
</tbody>
</table>

<h2>技术选型</h2>

<table>
<thead><tr><th align="left">层次</th><th align="left">选型</th></tr></thead>
<tbody>
<tr><td>桌面壳</td><td>Tauri 2</td></tr>
<tr><td>前端</td><td>React 19 · TypeScript · Vite 8</td></tr>
<tr><td>组件与样式</td><td>HeroUI v3 · Tailwind CSS v4 · React Aria</td></tr>
<tr><td>编辑器内核</td><td>Milkdown Crepe（ProseMirror）</td></tr>
<tr><td>源码模式</td><td>CodeMirror 6</td></tr>
<tr><td>状态管理</td><td>Zustand 5</td></tr>
<tr><td>本地存储</td><td>SQLite（sqlx，WAL 模式）</td></tr>
<tr><td>全文检索</td><td>SQLite FTS5，中文逐字索引</td></tr>
<tr><td>Word 导出</td><td>OOXML（zip + flate2）；公式由 MathML 转 Word 原生 OMML（roxmltree）</td></tr>
<tr><td>PDF 导出</td><td>WebView2 打印管线（webview2-com / windows）</td></tr>
<tr><td>网络请求</td><td>ureq，全部在 Rust 侧发出</td></tr>
</tbody>
</table>

<p>两条贯穿全局的约定：<strong>网络请求一律在 Rust 侧发</strong>（前端只调用类型化的 <code>invoke</code>），所以令牌、Cookie 这类东西不会进入 webview；<strong>宿主能力一律经命令层封装</strong>，前端拿不到文件系统与网络的原生句柄。</p>

<h2>开发</h2>

<p><strong>环境要求</strong>：Node.js 20+、Rust 稳定版工具链、Windows 上的 MSVC 生成工具，以及 WebView2 运行库（Windows 11 自带）。</p>

<table>
<thead><tr><th align="left">命令</th><th align="left">作用</th></tr></thead>
<tbody>
<tr><td><code>npm install</code></td><td>装前端依赖</td></tr>
<tr><td><code>npm run tauri dev</code></td><td>开发模式启动（前端热更新，Rust 改动自动重编）</td></tr>
<tr><td><code>npm run typecheck</code></td><td>TypeScript 类型检查</td></tr>
<tr><td><code>npm test</code></td><td>前端单元测试（vitest）</td></tr>
<tr><td><code>cargo test</code></td><td>Rust 单元测试（在 <code>src-tauri/</code> 下执行）</td></tr>
<tr><td><code>npm run tauri build</code></td><td>构建正式版，产出 <code>.exe</code> 与 <code>.msi</code> 安装包</td></tr>
<tr><td><code>python design/make-logo.py</code></td><td>重新生成品牌标记、应用图标与 favicon（需 <code>pip install fonttools pillow</code>）</td></tr>
<tr><td><code>python scripts/publish.py --help</code></td><td>发布工具：建仓库 / 发 Release / 传附件</td></tr>
</tbody>
</table>

<h2>项目结构</h2>

<pre>qingjian/
├─ src/                     前端（React + TypeScript）
│  ├─ components/           UI：编辑器、侧边栏、设置、对话框、更新提示
│  ├─ lib/                  纯逻辑：命令注册表、快捷键、导出中间表示、
│  │                        Markdown 解析、路径换算、更新检查
│  ├─ stores/               Zustand 状态：workspace / settings / ui
│  ├─ styles/               主题变量与全局样式
│  └─ types/                与 Rust 模型一一对应的类型定义
├─ src-tauri/               桌面壳与全部本地能力（Rust）
│  ├─ src/commands/         暴露给前端的命令：workspace / note / settings /
│  │                        export / docx / pdf / upload / update …
│  ├─ src/services.rs       文件与文本工具：原子写入、路径校验、
│  │                        编码嗅探、内容哈希
│  ├─ migrations/           SQLite 迁移（行尾不能动，见下）
│  └─ icons/                应用图标，由 design/make-logo.py 生成
├─ design/make-logo.py      品牌标记的唯一真源：字形轮廓、图标、favicon
├─ scripts/publish.py       发布工具（GitHub / Gitee）
└─ .github/workflows/       打 tag 自动构建并发布</pre>

<p><strong>关于 <code>migrations/*.sql</code> 的行尾</strong>：sqlx 在编译期对迁移文件做 SHA-384 校验，行尾被 Git 转换过就会被判为「这条迁移被改过」而拒绝启动。<code>.gitattributes</code> 里用 <code>-text</code> 把这三个文件钉成逐字节原样，改它们之前请先读那行注释。</p>

<h2>发布新版本</h2>

<ol>
<li>改 <code>src-tauri/tauri.conf.json</code> 里的版本号（安装包与应用内「关于」都取自它），<code>package.json</code> 与 <code>Cargo.toml</code> 的版本号顺手对齐，再更新 <code>release-notes.md</code>。</li>
<li>提交，然后打 tag 并推送：<code>git tag -a v0.2.0 -m "青简 v0.2.0" &amp;&amp; git push origin v0.2.0</code>。</li>
<li>GitHub Actions 会自动跑测试、构建 Windows 安装包，并把它们挂到 <code>v0.2.0</code> 这个 Release 上（见 <code>.github/workflows/release.yml</code>）。</li>
<li>要同步发到 Gitee，在本地构建后执行：<code>python scripts/publish.py gitee --repo &lt;owner&gt;/qingjian --tag v0.2.0 --notes-file release-notes.md --create-repo --asset "本地路径=ASCII 发布名"</code>。</li>
</ol>

<p>两点经验写在这里免得再踩：<strong>安装包的发布名要用 ASCII</strong>——GitHub 保存附件名时会丢掉非 ASCII 字符，本地叫 <code>青简_x64-setup.exe</code> 的文件必须用 <code>--asset 路径=Qingjian_x64-setup.exe</code> 换名发布；<strong>MSI 的代码页必须是 936</strong>，WiX 默认的 1252 装不下「青简」两个字，<code>tauri.conf.json</code> 里已指定 <code>zh-CN</code>。</p>

<h2>已知限制</h2>

<ul>
<li>只有 Windows 版本。内核（Tauri + Rust）本身跨平台，但 PDF 导出依赖 WebView2 的打印管线，macOS / Linux 需要另找方案。</li>
<li>渲染大文档（数万字以上）时首屏会慢一秒左右，Milkdown 对超长文档不是最优解。</li>
<li>快捷键目前不可自定义。少数键位与系统或命令冲突时，只能按上表标注的替代键使用。</li>
<li><strong>不支持原地自动更新</strong>：应用会检查新版本并把安装包下到「下载」文件夹，仍需要你关闭青简后自行运行安装包。</li>
<li>数学公式的导出只支持 Word（OMML）与 HTML；PDF 里公式是渲染后的静态图形。</li>
</ul>

<h2>开源地址</h2>

<ul>
<li>GitHub：<a href="https://github.com/Soulmte/qingjian">https://github.com/Soulmte/qingjian</a>（主仓库，Release 在此）</li>
<li>Gitee：<a href="https://gitee.com/Soulmte/qingjian">https://gitee.com/Soulmte/qingjian</a>（镜像）</li>
</ul>

<p>发现问题、想要某个功能，欢迎提 issue。提 issue 时如果能附上「在做什么、期待什么、实际发生了什么」，修起来会快很多。</p>
