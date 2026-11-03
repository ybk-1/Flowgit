# 发布 / Releasing

Flowgit 发布三个 npm 包：`@flowgit/core`（核心库）、`@flowgit/web`（本机网页看板）和 `flowgit`（命令行），三个包用同一个版本号。日常发布由 GitHub Actions 的 [`release.yml`](../.github/workflows/release.yml) 完成：推一个 `v*` tag，它就测试、打包、发布。它用 npm 的 [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（OIDC），仓库里不存任何 npm token。

Flowgit publishes three npm packages on one shared version: `@flowgit/core` (the core library), `@flowgit/web` (the local web board) and `flowgit` (the CLI). Routine releases run in GitHub Actions ([`release.yml`](../.github/workflows/release.yml)): push a `v*` tag and it tests, packs and publishes. It uses npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so no npm token is stored anywhere.

## 第一次发布（只做一次）/ First release (once)

npm 只能给已经存在的包设置 Trusted Publishing，所以第一个版本要在自己电脑上手动发。

npm can only set up Trusted Publishing for a package that already exists, so the first version is published by hand.

1. **npm 账号**：在 [npmjs.com](https://www.npmjs.com/) 注册，并开启双重验证（2FA）。
   **npm account**: sign up at [npmjs.com](https://www.npmjs.com/) and turn on two-factor authentication (2FA).
2. **建组织 `flowgit`**：头像菜单 → Add Organization，名字填 `flowgit`，选免费的 "Unlimited public packages"。组织名就是 `@flowgit/` 这个 scope，没有它发不了 `@flowgit/core` 和 `@flowgit/web`。
   **Create the `flowgit` organization**: avatar menu → Add Organization, name it `flowgit`, pick the free "Unlimited public packages" plan. The organization name is the `@flowgit/` scope; `@flowgit/core` and `@flowgit/web` can't be published without it.
3. **手动发布**（在最新的 `main` 上，工作区要干净）：
   **Publish by hand** (on the latest `main`, with a clean working tree):

   每行单独运行，Windows PowerShell 5.1 也能照抄（它不认 `&&`）。
   Run one line at a time; this also works as is in Windows PowerShell 5.1, which has no `&&`.

   ```bash
   npm login
   npm whoami
   pnpm install --frozen-lockfile
   git clean -fdX packages/core/dist packages/web/dist packages/cli/dist
   pnpm build
   pnpm test
   node scripts/pack-smoke.mjs
   cd packages/core
   pnpm publish --access public
   cd ../web
   pnpm publish --access public
   cd ../cli
   pnpm publish --access public
   cd ../..
   git tag v0.1.0
   git push origin v0.1.0
   ```

   `npm whoami` 应该显示你的 npm 用户名。`--frozen-lockfile` 不会改 `pnpm-lock.yaml`，工作区不干净时 `pnpm publish` 会停下。`git clean -fdX` 只删三个包的 `dist`，也就是以前构建留下的文件：切换提交时 `dist/` 会留着，`pnpm build` 也不会删掉已经没有源码的旧文件，不删就会一起打进包里。`pack-smoke` 先确认打出来的包装得起来。一定要用 `pnpm publish`，它会把 `"workspace:*"` 换成真正的版本号。按 core、web、cli 的顺序发。最后推的 tag 会触发 `release.yml`，它看到三个版本都已经在 npm 上就会跳过发布，只留下 tag 记录这一版。
   `npm whoami` should print your npm username. `--frozen-lockfile` leaves `pnpm-lock.yaml` alone; `pnpm publish` stops when the working tree isn't clean. `git clean -fdX` deletes only the three packages' `dist`, the output of earlier builds: `dist/` survives switching commits, and `pnpm build` doesn't remove old files whose sources are gone, so they would ship in the package. `pack-smoke` first makes sure the packed packages install. Use `pnpm publish`: it replaces `"workspace:*"` with the real version. Publish core, then web, then the CLI. The tag pushed at the end triggers `release.yml`, which finds all three versions already on npm and skips publishing, so the tag just marks the release.

   npm 现在有分段发布（[staged publishing](https://docs.npmjs.com/staged-publishing)）。发布一个还不存在的包时，npm 可能先放一个占名字的 `0.0.0-stage` 版本，你在浏览器用 2FA 确认以后，真正的版本才上线，这之前 `npm view` 会显示 `0.0.0-stage`。`npm stage list <包名>` 列出还在等确认的版本，可以在 npmjs.com 的 Staged Packages 标签页确认，也可以用 `npm stage approve <id>`（npm 11.15 以上）。占位版本会留在版本列表里，不影响安装，`latest` 指向真正的版本。
   npm now has [staged publishing](https://docs.npmjs.com/staged-publishing). When you publish a package that doesn't exist yet, npm may first put up a `0.0.0-stage` placeholder to hold the name; the real version goes live once you confirm it with 2FA in the browser, and until then `npm view` prints `0.0.0-stage`. `npm stage list <package>` lists versions still waiting; confirm them in the Staged Packages tab on npmjs.com or with `npm stage approve <id>` (npm 11.15 or newer). The placeholder stays in the version list without affecting installs, and `latest` points to the real version.

4. **设置 Trusted Publishing**：在 npmjs.com 打开每个包的 Settings → Trusted Publisher → GitHub Actions，填：
   **Set up Trusted Publishing**: on npmjs.com, open each package's Settings → Trusted Publisher → GitHub Actions and fill in:

   | 字段 / Field | 值 / Value |
   | --- | --- |
   | Organization or user | `cgold9820-dotcom` |
   | Repository | `Flowgit` |
   | Workflow filename | `release.yml` |
   | Environment | 留空 / leave empty |

   并允许它直接 `npm publish`。注意：新建的配置要在 **2 天内**完成第一次成功发布，所以等准备好发下一个版本时再设置。npm 保存时不会检查这些字段，填错了要到发布时才会报错。
   Allow it to run `npm publish` directly. A new configuration must complete its first successful publish **within 2 days**, so set it up when the next version is ready. npm doesn't check these fields when you save them; a mistake only shows at publish time.

5. 第一次用 CI 发布成功后，在每个包的 Settings → Publishing access 选 "Require two-factor authentication and disallow tokens"，这样只有 CI 和开了 2FA 的你能发布。
   After the first successful CI publish, set each package's Settings → Publishing access to "Require two-factor authentication and disallow tokens", so only CI and you (with 2FA) can publish.

## 日常发布 / Routine release

```bash
git checkout -b release/v0.1.1 origin/main
node scripts/release-version.mjs set 0.1.1     # 所有包一起改版本 / bump every package
# 在 CHANGELOG.md 里把"未发布"改成版本号和日期 / in CHANGELOG.md, turn "Unreleased" into the version and date
git commit -am "发布 0.1.1 / Release 0.1.1"
# 开 PR、合并 / open a PR and merge it
git checkout main && git pull
git tag v0.1.1 && git push origin v0.1.1      # 触发 release.yml / triggers release.yml
```

`release.yml` 会检查 tag 和所有包的版本一致，跑完整的测试和打包冒烟测试，然后按 core、web、cli 的顺序发布；npm 上已经有的版本会跳过，所以失败后直接重跑这个 workflow 就行。想只检查不发布，在 Actions 页面手动运行 Release。

`release.yml` checks the tag matches every package version, runs the full tests and the pack smoke test, then publishes core, web and the CLI in that order. Versions already on npm are skipped, so a failed run can simply be re-run. To check without publishing, run Release by hand from the Actions page.

## 注意 / Notes

- **来源证明（provenance）**：npm 只给公开仓库自动生成。仓库已经公开，所以之后由 CI 发布的版本会自动带上，不用改 workflow。0.1.0 是在自己电脑上手动发布的，没有 provenance。
  **Provenance**: npm generates it only for public repositories. The repository is public now, so versions published by CI get it automatically with no workflow change. 0.1.0 was published by hand from a computer and has none.
- **不要用 token 发布**：npm 会在 2027 年 1 月取消用 granular token 直接发布新版本，所以这里只用 Trusted Publishing。
  **Don't publish with tokens**: npm removes direct publishing with granular access tokens in January 2027, so this setup uses Trusted Publishing only.
- `package.json` 的 `repository.url` 必须和 GitHub 仓库一致，Trusted Publishing 会检查。改仓库名或转移仓库时要一起改。
  `repository.url` in `package.json` must match the GitHub repository; Trusted Publishing checks it. Update it if the repository is renamed or moved.
- CI 每次都会跑 `scripts/pack-smoke.mjs`：像发布一样打包，装进空目录，再用装好的命令行跑一个流程。包里少了文件会在合并前发现。
  CI runs `scripts/pack-smoke.mjs` on every push: it packs like a release, installs into an empty folder and runs a flow with the installed CLI, so a missing file is caught before merge.
