# 发布 / Releasing

Flowgit 发布两个 npm 包：`@flowgit/core`（核心库）和 `flowgit`（命令行），两个包用同一个版本号。日常发布由 GitHub Actions 的 [`release.yml`](../.github/workflows/release.yml) 完成：推一个 `v*` tag，它就测试、打包、发布。它用 npm 的 [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（OIDC），仓库里不存任何 npm token。

Flowgit publishes two npm packages on one shared version: `@flowgit/core` (the core library) and `flowgit` (the CLI). Routine releases run in GitHub Actions ([`release.yml`](../.github/workflows/release.yml)): push a `v*` tag and it tests, packs and publishes. It uses npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so no npm token is stored anywhere.

## 第一次发布（只做一次）/ First release (once)

npm 只能给已经存在的包设置 Trusted Publishing，所以第一个版本要在自己电脑上手动发。

npm can only set up Trusted Publishing for a package that already exists, so the first version is published by hand.

1. **npm 账号**：在 [npmjs.com](https://www.npmjs.com/) 注册，并开启双重验证（2FA）。
   **npm account**: sign up at [npmjs.com](https://www.npmjs.com/) and turn on two-factor authentication (2FA).
2. **建组织 `flowgit`**：头像菜单 → Add Organization，名字填 `flowgit`，选免费的 "Unlimited public packages"。组织名就是 `@flowgit/` 这个 scope，没有它发不了 `@flowgit/core`。
   **Create the `flowgit` organization**: avatar menu → Add Organization, name it `flowgit`, pick the free "Unlimited public packages" plan. The organization name is the `@flowgit/` scope; `@flowgit/core` can't be published without it.
3. **手动发布**（在最新的 `main` 上，工作区要干净）：
   **Publish by hand** (on the latest `main`, with a clean working tree):

   ```bash
   npm login
   pnpm install && pnpm build && pnpm test
   node scripts/pack-smoke.mjs          # 先确认装得起来 / make sure it installs
   cd packages/core && pnpm publish --access public
   cd ../cli && pnpm publish --access public
   ```

   一定要用 `pnpm publish`，它会把 `"@flowgit/core": "workspace:*"` 换成真正的版本号。先发 core，再发 cli。
   Use `pnpm publish`: it replaces `"@flowgit/core": "workspace:*"` with the real version. Publish core first, then the CLI.

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
node scripts/release-version.mjs set 0.1.1     # 两个包一起改版本 / bump both packages
# 在 CHANGELOG.md 里把"未发布"改成版本号和日期 / in CHANGELOG.md, turn "Unreleased" into the version and date
git commit -am "发布 0.1.1 / Release 0.1.1"
# 开 PR、合并 / open a PR and merge it
git checkout main && git pull
git tag v0.1.1 && git push origin v0.1.1      # 触发 release.yml / triggers release.yml
```

`release.yml` 会检查 tag 和两个包的版本一致，跑完整的测试和打包冒烟测试，然后先发 core、再发 cli；npm 上已经有的版本会跳过，所以失败后直接重跑这个 workflow 就行。想只检查不发布，在 Actions 页面手动运行 Release。

`release.yml` checks the tag matches both package versions, runs the full tests and the pack smoke test, then publishes core before the CLI. Versions already on npm are skipped, so a failed run can simply be re-run. To check without publishing, run Release by hand from the Actions page.

## 注意 / Notes

- **来源证明（provenance）**：npm 只给公开仓库自动生成。仓库现在是私有的，所以发布的版本没有 provenance；仓库公开后，之后的版本会自动带上，不用改 workflow。
  **Provenance**: npm generates it only for public repositories. The repository is private for now, so versions published now have none; once it's public, later versions get it automatically with no workflow change.
- **不要用 token 发布**：npm 会在 2027 年 1 月取消用 granular token 直接发布新版本，所以这里只用 Trusted Publishing。
  **Don't publish with tokens**: npm removes direct publishing with granular access tokens in January 2027, so this setup uses Trusted Publishing only.
- `package.json` 的 `repository.url` 必须和 GitHub 仓库一致，Trusted Publishing 会检查。改仓库名或转移仓库时要一起改。
  `repository.url` in `package.json` must match the GitHub repository; Trusted Publishing checks it. Update it if the repository is renamed or moved.
- CI 每次都会跑 `scripts/pack-smoke.mjs`：像发布一样打包，装进空目录，再用装好的命令行跑一个流程。包里少了文件会在合并前发现。
  CI runs `scripts/pack-smoke.mjs` on every push: it packs like a release, installs into an empty folder and runs a flow with the installed CLI, so a missing file is caught before merge.
