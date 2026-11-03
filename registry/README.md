# 社区模板登记 / Community template registry

`registry/community/<id>.json` 是社区模板的名单，一个条目一个文件，这样两个人同时登记不会改到同一个文件。自带模板（装在 `flowgit` 里的那些）不写在这里。一条记录对应一个 Git 仓库里的一份流程，`flowgit init -t <id>` 会按这条记录去复制。字段和以前的数组一样，见 `community.schema.json` 的 `entry`。站点构建把这些文件合并成 https://flowgit.dev/registry.json。

`registry/community/<id>.json` is the list of community templates, one file per entry, so two people can register at the same time without editing the same file. Bundled templates (the ones shipped inside `flowgit`) are not listed here. Each entry is one flow in a Git repository, and `flowgit init -t <id>` copies it from that entry. The fields are the same as before: `entry` in `community.schema.json`. The site build merges the files into https://flowgit.dev/registry.json.

`flowgit templates --all` 先读 https://flowgit.dev/registry.json，读不到再读仓库里的这个目录。旧的单文件 `community.json`（一个 JSON 数组）也还能读。`FLOWGIT_REGISTRY` 可以换成别的网址、一个 JSON 文件或一个目录。读不到时，`flowgit templates --all` 仍列出自带模板，并只提示一行。

`flowgit templates --all` reads https://flowgit.dev/registry.json first, then this directory in the checkout. The old single-file `community.json` (one JSON array) still reads too. `FLOWGIT_REGISTRY` can point at another URL, a JSON file or a directory. If the list cannot be read, `flowgit templates --all` still prints the bundled templates and one note.

## 怎么登记 / How to register

1. 把流程放在你的公开 Git 仓库里（可以是本仓库的 `examples/`，也可以是你自己的仓库）。根目录要有 LICENSE，README 要有「依据 / Sources」，不要提交 `runs/` 和密钥。 / Put the flow in a public Git repository (this repo's `examples/`, or a repository of your own). The root needs a LICENSE, the README needs 依据 / Sources, and do not commit `runs/` or secrets.
2. 在流程目录里运行 `flowgit publish --git <地址> --author <作者> --tag <标签> --language zh`。不过关会列出双语原因并停住。过关会打印 JSON。 / From the flow directory, run `flowgit publish --git <url> --author <name> --tag <tag> --language zh`. A failure lists the reasons in both languages and stops. Success prints JSON.
3. GitHub 的新建文件页面没有写明预填参数，所以命令不代你打开带内容的链接，也不调用 GitHub API。按打印的步骤，新建 `registry/community/<id>.json`，把 JSON 贴进去，开 Pull Request。标题里写上模板的 id。 / GitHub's new-file page does not document prefill parameters, so the command does not open a prefilled link and does not call the GitHub API. Follow the printed steps: add `registry/community/<id>.json`, paste the JSON, and open a pull request. Put the template id in the title.

改了 `registry/community/` 的 Pull Request 会浅克隆条目里的仓库（按 `ref`），只读：校验、密钥扫描、许可证。不运行阶段，不安装依赖，并留一条双语评论。

A pull request that changes `registry/community/` shallow-clones the entry's repository (at `ref`), read only: validation, a secret scan and the license. It runs no stage, installs nothing, and leaves one bilingual comment.

仓库根目录没有 `flow.json` 时，把子目录写在地址末尾：`https://github.com/org/repo.git#path=examples/my-flow`。`flowgit init` 会只复制这个子目录。不要用 `..` 跳出仓库。

When the flow is not at the root of the repository, put the subdirectory at the end of the URL: `https://github.com/org/repo.git#path=examples/my-flow`. `flowgit init` copies only that subdirectory. `..` cannot point outside the repository.

## 审核标准 / Review bar

合并前要满足这几条。 / A pull request is merged only when all of these hold:

- **能通过校验 / It validates.** `registry/community/*.json` 是合法 JSON，并且符合 `community.schema.json`（`node scripts/check-registry.mjs`，需要先 `pnpm build`）。 / `registry/community/*.json` is valid JSON and matches `community.schema.json` (`node scripts/check-registry.mjs` after `pnpm build`).
- **没有密钥 / No secrets.** 登记和模板里都不要有令牌、密码、私钥、邮箱或只在你电脑上才有的路径。 / The entry and the template contain no tokens, passwords, private keys, emails, or paths that exist only on your machine.
- **许可证写清楚 / The license is clear.** `license` 用大家认得的名字，例如 `Apache-2.0` 或 `MIT`，并和仓库里的许可证一致。 / `license` is a name people recognise, such as `Apache-2.0` or `MIT`, and it matches the license in the repository.
- **模板有「依据 / Sources」。** 模板的 README 里要有一节 `依据 / Sources`（或 `参考资料 / References`），说明做法参考了什么，方便别人判断能不能用。 / The template README has a `依据 / Sources` section (or `参考资料 / References`) saying what the flow is based on, so other people can judge it.

## 字段 / Fields

| 字段 / Field | 必填 / Required | 说明 / What it is |
| --- | --- | --- |
| `id` | 是 / yes | 小写字母、数字、连字符。`flowgit init -t` 用这个名字。 / Lowercase letters, digits and hyphens. This is the `flowgit init -t` name. |
| `name` | 是 / yes | `{ "zh", "en" }`，两句都要有。 / `{ "zh", "en" }`, both required. |
| `description` | 是 / yes | `{ "zh", "en" }`，各一句。 / `{ "zh", "en" }`, one sentence each. |
| `git` | 是 / yes | Git 地址。子目录写成 `#path=<子目录>`。 / Git URL. A subdirectory is `#path=<subdir>`. |
| `ref` | 否 / no | 分支或标签。不写就用仓库的默认分支。 / Branch or tag. Omit for the repository's default branch. |
| `author` | 是 / yes | 作者名。 / Author name. |
| `tags` | 是 / yes | 字符串数组，画廊用来筛选。 / Strings the gallery filters on. |
| `language` | 是 / yes | `zh`、`en` 或两个都有。 / `zh`, `en`, or both. |
| `license` | 是 / yes | 清楚的许可证名字。 / A clear license name. |

## 试一下 / Try it

```bash
flowgit templates --all
FLOWGIT_REGISTRY=./registry/community flowgit templates --all
flowgit publish --git https://github.com/you/your-flow.git --author "Your Name" --language zh
flowgit init my-page -t agent-page
flowgit gallery build
```

`gallery build` 把静态页面写到 `gallery-dist/`。这个命令不部署，仓库的 GitHub Pages 也不会因为这条命令打开。

`gallery build` writes static pages to `gallery-dist/`. The command does not deploy, and it does not turn on GitHub Pages.
