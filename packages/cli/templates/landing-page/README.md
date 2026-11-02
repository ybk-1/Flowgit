# 落地页 / Landing page

简报 → 结构 → 文案 → 照片（可空）→ 生成网页 → 检查。

Brief → structure → copy → photos (optional) → build → check.

| 阶段 / Stage | 谁来做 / Who | 产物 / Output |
| --- | --- | --- |
| 简报 brief | 你 / you | `brief.md` |
| 结构 structure | 模型（`prompts/structure.md`） | `structure.json` |
| 文案 copy | 模型（`prompts/copy.md`） | `copy.json` |
| 照片 photos | 你 / you | `images/` |
| 生成 build | `scripts/build.mjs` | `site/index.html`、`site/style.css`、`site/images/` |
| 检查 check | `scripts/check.mjs` | `check-report.md` |

`copy.json` 里每个区块的键和 `structure.json` 的 `id` 一一对应，各有标题、正文和按钮文字。照片按 `structure.json` 里的 `image` 命名。没有对应文件时，页面用一块纯色加说明代替，所以空的 `images/` 也能生成。

Each key in `copy.json` matches one `id` in `structure.json`, with a heading, a body and button text. Photos are named from the `image` field in `structure.json`. A missing file becomes a plain color block with a caption, so an empty `images/` folder still builds.

生成的页面用模板自己的 HTML 和 CSS：手机宽度、深色模式。用户写的文字都会转义。页面不加载网络上的脚本、样式、字体或图片；表单只停在本页，不会把内容发出去。

The page is the template's own HTML and CSS: phone width and dark mode. User text is escaped. The page loads no remote script, stylesheet, font or image; the form stays on the page and does not send anything.

## 输入 / Inputs

| 输入 / Input | 默认 / Default | 说明 | Description |
| --- | --- | --- | --- |
| `language` | `zh` | 结构、文案、页面固定文字和检查报告的语言：`zh` 或 `en` | Language of the structure, copy, fixed page text and the check report |
| `product` | （必填 / required） | 产品名称 | Product name |
| `audience` | （必填 / required） | 访问者是谁 | Who the visitor is |
| `goal` | （必填 / required） | 希望访问者做什么，例如留下邮箱 | What the visitor should do, for example leave an email |

## 怎么跑 / How to run

```bash
flowgit init ~/my-page -t landing-page
cd ~/my-page
# 示例简报是虚构的「箱栖」。换成你的产品时，改 brief.md，并改这三项。
# The sample brief is the fictional BoxNest. To use your product, edit brief.md and these three.
flowgit inputs set product=箱栖 audience=养猫的人 goal=留下邮箱
flowgit inputs set language=zh          # 或 en / or en
flowgit run all
```

没有 API key 时，用模板自带的固定回复。示例回复是中文，对应仓库里的 `brief.md`。

Without an API key, the bundled canned replies run the flow. The demo replies are in Chinese and match the shipped `brief.md`.

```bash
FLOWGIT_LLM_MOCK_DIR=demo-replies flowgit run all
# PowerShell: $env:FLOWGIT_LLM_MOCK_DIR = "demo-replies"; flowgit run all
```

打开 `site/index.html` 即可看页面。

Open `site/index.html` to read the page.

## 照片 / Photos

把图片放进 `images/`，文件名用 `structure.json` 里的 `image`，例如 `hero.jpg`。文件夹可以是空的。缺图的区块会显示「图片待补」和这个文件名，以及该区块的用途。用到的图片会复制到 `site/images/`。

Put images in `images/`, named after the `image` field in `structure.json`, for example `hero.jpg`. The folder can be empty. A missing image shows "Image to add", the file name, and the block's purpose. Images that were used are copied to `site/images/`.

## 检查 / Check

`check-report.md` 列出五类问题：

- 图片没有替代文本（`alt` 为空或没有）
- 空链接（没有 `href`、`href=""` 或 `href="#"`）
- 标题跳级（例如 `h1` 后面直接是 `h3`，或页面不是从 `h1` 开始）
- 过长的区块（标题超过 80 个字符，或正文超过 500 个字符）
- `copy.json` 里有、页面上没有的区块

有问题时这一步会失败，报告仍然会写出来。

`check-report.md` lists five kinds of problem:

- images missing alt text (empty or absent `alt`)
- empty links (no `href`, `href=""`, or `href="#"`)
- skipped heading levels (for example `h1` followed by `h3`, or a page that does not start at `h1`)
- overly long blocks (a heading over 80 characters, or a body over 500)
- blocks present in `copy.json` but missing from the page

The stage fails when it finds a problem, and it still writes the report.
