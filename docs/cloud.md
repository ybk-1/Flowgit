# Flowgit 云端 API / Flowgit Cloud API

云端第一版的接口说明（第六批 #169）。网页版（#172）、多人协作（#173）和命令行（#174）照这份文档接云端；云端运行和 key 保管（#170）、远端 MCP（#171）以后各加自己的小节。代码在 `packages/server`（Apache-2.0）。

The API of the first Flowgit Cloud (batch 6, #169). The web app (#172), live collaboration (#173) and the CLI (#174) build against this document; cloud runs and the key vault (#170) and remote MCP (#171) add their own sections later. The code is in `packages/server` (Apache-2.0).

流程格式不变：云端的流程和电脑上的流程是同一套文件（`flow.json` 或 `flow.md`、提示词、产物、`runs/`）。没登录时，本机看板、命令行和网页版都和以前一样。

The flow format does not change: a cloud flow is the same set of files as a flow on a computer (`flow.json` or `flow.md`, prompts, outputs, `runs/`). Signed out, the local board, the CLI and the web app work as before.

## 在哪里 / Where it runs

| 环境 / Environment | 地址 / Address | 部署 / Deploy |
| --- | --- | --- |
| 正式 / production | `https://flowgit.dev/api/*`（Worker `flowgit-api`，路由在 Pages 网站前面 / a route in front of the Pages site） | 手动运行 Actions 里的 Server / run the Server workflow by hand |
| 测试 / staging | `https://staging.flowgit.dev/api/*`，`/app/` 是网页版 / the web app at `/app/`（Worker `flowgit-api-staging`） | 推到 `main` 自动部署 / every push to `main` |
| 本机 / local | `pnpm --filter @flowgit/server dev`（wrangler 的本机模拟环境 / wrangler's local emulator） | — |

API 和网页版同一个域名，所以浏览器请求不跨域，不需要 CORS。

The API shares an origin with the web app, so browser requests are same-origin and need no CORS.

## 登录 / Signing in

- **浏览器 / Browser**：打开 `GET /api/auth/github` 或 `GET /api/auth/google`（可带 `next=<本站路径 / a path on this site>` 和 `invite=<邀请码 / code>`），登录后回到 `next`（默认 `/app/`）。会话放在 cookie `__Host-flowgit_session`（HttpOnly、Secure、SameSite=Lax，30 天）。用的是 OAuth 2.0 授权码加 PKCE，GitHub 不要任何权限范围（只读公开资料），Google 只要 `openid email profile`。
- **Browser**: open `GET /api/auth/github` or `GET /api/auth/google` (optionally with `next=<a path on this site>` and `invite=<code>`); after sign-in the browser returns to `next` (default `/app/`). The session is the cookie `__Host-flowgit_session` (HttpOnly, Secure, SameSite=Lax, 30 days). It is the OAuth 2.0 authorization code flow with PKCE; GitHub gets no scope (public profile only) and Google only `openid email profile`.
- **写操作要同源 / Writes must be same-origin**：带 cookie 的 `POST`、`PUT`、`PATCH`、`DELETE` 和 WebSocket 连接，`Origin` 头必须是本站，否则 403。浏览器会自动带上 `Origin`。
- Cookie requests that change something (`POST`, `PUT`, `PATCH`, `DELETE`) and WebSocket upgrades must carry this site's own `Origin`, or they get 403. Browsers send `Origin` on their own.
- **命令行 / CLI**：设备码登录（RFC 8628 的形状）。拿到的令牌放在 `Authorization: Bearer <token>`，90 天有效；带令牌的请求不检查 `Origin`。
- **CLI**: the device code flow (shaped like RFC 8628). The token goes in `Authorization: Bearer <token>` and lasts 90 days; bearer requests skip the `Origin` check.

  1. `POST /api/auth/device` → `{ device_code, user_code, verification_uri, verification_uri_complete, expires_in: 600, interval: 5 }`
  2. 让人打开 `verification_uri_complete`，登录后核对 `user_code` 并确认。/ The person opens `verification_uri_complete`, signs in, checks `user_code` and approves.
  3. 每 `interval` 秒 `POST /api/auth/device/token` `{ "device_code" }`。没确认时 400，`code` 是 `authorization_pending`；过期是 `expired_token`；用过或不认识是 `invalid_grant`。确认后 200：`{ token, token_type: "bearer", expires_at, expires_in }`，每个设备码只给一次。/ Poll `POST /api/auth/device/token` with `{ "device_code" }` every `interval` seconds. Before approval: 400 with `code: "authorization_pending"`; `expired_token` when expired; `invalid_grant` when unknown or used. After approval: 200 with `{ token, token_type: "bearer", expires_at, expires_in }`, once per device code.
- `POST /api/auth/logout`：结束当前会话（cookie 或令牌）。/ Ends the current session (cookie or token).
- `GET /api/auth/providers` → `{ github, google, test }`：哪些登录方式已经设置。/ Which sign-in methods are set up.
- **只在本机 / Local only**：`POST /api/auth/test` `{ subject, name?, invite?, kind?: "web" | "cli" }` 不经 OAuth 直接登录，返回 `{ user, token, joined }` 并设 cookie。只有 `ENVIRONMENT` 是 `local` 而且 `FLOWGIT_TEST_LOGIN=1`（`.dev.vars` 或测试配置）时才有，staging 和正式环境一律 404。给 e2e 测试用，`subject` 为 `admin` 的人是管理员。
- **Local only**: `POST /api/auth/test` with `{ subject, name?, invite?, kind?: "web" | "cli" }` signs in without OAuth, returns `{ user, token, joined }` and sets the cookie. It exists only when `ENVIRONMENT` is `local` and `FLOWGIT_TEST_LOGIN=1` (in `.dev.vars` or the test config); staging and production always answer 404. It is for e2e tests; the person with `subject` `admin` is an admin.

### 邀请码 / Invite codes

测试版只能凭邀请码注册。没有可用邀请码的新人登录时看到“需要邀请码”的页面（403，错误码 `invite_needed`），可以在页面里填邀请码再登录。`ADMINS`（wrangler 配置，形如 `github:<数字 id>`）里的人不用邀请码。

The beta is invite-only. A new person without a usable code sees an "invite needed" page (403, code `invite_needed`) where they can enter one and sign in again. People in `ADMINS` (wrangler config, like `github:<numeric id>`) need no code.

- **注册码 / Sign-up codes**：只有管理员能建（`POST /api/invites`），让一个新人注册。/ Only admins create them; each lets one new person sign up.
- **工作区邀请 / Workspace invites**：拥有者建（`POST /api/workspaces/:ws/invites`），带角色。新人用它注册并加入；已有账号的人用 `POST /api/invites/accept` 加入。已有的角色只升不降。/ Owners create them, with a role. A new person signs up and joins with one; someone with an account joins through `POST /api/invites/accept`. An existing role is only ever raised.
- 邀请码形如 `FG-XXXXX-XXXXX-XXXXX-XXXXX`，只在创建时返回一次（服务器只存哈希），默认 7 天、用一次。不是管理员的人 30 天最多建 20 个。邀请链接是 `/app/?invite=<code>`。/ Codes look like `FG-XXXXX-XXXXX-XXXXX-XXXXX`, are returned only when created (the server keeps a hash), and last 7 days for one use by default. A non-admin can create at most 20 in 30 days. The invite link is `/app/?invite=<code>`.

## 角色 / Roles

每个工作区的成员是 `owner`（拥有者）、`editor`（编辑）或 `viewer`（只看）。每个接口都在服务器上检查：

Each workspace member is an `owner`, an `editor` or a `viewer`. Every route checks on the server:

| 做什么 / Action | viewer | editor | owner |
| --- | --- | --- | --- |
| 看流程、文件、版本、对比、成员 / read flows, files, versions, diffs, members | ✓ | ✓ | ✓ |
| 建流程、改文件、上传、回退、改阶段和输入 / create flows, write files, upload, restore, edit stages and inputs | | ✓ | ✓ |
| 删流程、邀请、改角色、移除成员、改工作区名字、看操作记录 / delete flows, invite, change roles, remove members, rename the workspace, read the audit log | | | ✓ |

不是成员时一律 404（不透露工作区或流程存不存在）；是成员但角色不够时 403；没登录时 401。工作区至少留一个拥有者（409）。每个人都可以自己退出工作区。

Non-members always get 404 (so ids can't be probed); members whose role is too low get 403; signed-out requests get 401. A workspace keeps at least one owner (409). Anyone may leave a workspace.

## 接口 / Routes

所有接口在 `/api` 下，JSON 进 JSON 出（除了文件内容），错误都是 `{ "error": "<中文> / <English>" }`，有时多一个 `code`。

Everything is under `/api`, JSON in and out (except file contents), and every error is `{ "error": "<中文> / <English>" }`, sometimes with a `code`.

### 账号和工作区 / Account and workspaces

| 方法 / Method | 路径 / Path | 说明 / Notes |
| --- | --- | --- |
| GET | `/api/me` | `{ user, admin, workspaces, via }`；`via` 是 `cookie` 或 `bearer` |
| GET | `/api/workspaces` | `{ workspaces: [{ id, name, created_at, role, members, flows }] }` |
| POST | `/api/workspaces` | `{ name }` → 201 `{ workspace }`；测试版每人最多拥有 10 个 / at most 10 owned per person in the beta |
| GET | `/api/workspaces/:ws` | `{ workspace, role, storage: { used, quota } }` |
| PATCH | `/api/workspaces/:ws` | `{ name }`，owner |
| GET | `/api/workspaces/:ws/members` | `{ members: [{ id, name, avatar_url, role, created_at, logins }] }` |
| PATCH | `/api/workspaces/:ws/members/:user` | `{ role }`，owner |
| DELETE | `/api/workspaces/:ws/members/:user` | owner，或自己退出 / or leave yourself |
| GET | `/api/workspaces/:ws/invites` | owner |
| POST | `/api/workspaces/:ws/invites` | `{ role?, days? }`（默认 editor、7 天 / defaults editor, 7 days）→ 201 `{ id, code, expiresAt, url }` |
| GET / POST | `/api/invites` | 注册码，管理员 / sign-up codes, admins; `{ maxUses?, days? }` |
| DELETE | `/api/invites/:id` | 作废 / revoke |
| POST | `/api/invites/accept` | `{ code }` → `{ workspaceId, role }` |
| GET | `/api/workspaces/:ws/audit?before=<ms>` | 操作记录，最新的在前，每页 100 条，owner / the audit log, newest first, 100 per page |

### 流程 / Flows

| 方法 / Method | 路径 / Path | 说明 / Notes |
| --- | --- | --- |
| GET | `/api/templates` | 自带模板 / bundled templates: `[{ id, name, stages }]` |
| GET | `/api/workspaces/:ws/flows` | `{ flows: [{ id, workspace_id, name, created_by, created_at, updated_at, bytes }] }`，最近改的在前 / most recently changed first |
| POST | `/api/workspaces/:ws/flows` | `{ name?, template }` 或 / or `{ name, files: { "<相对路径 / relative path>": "<base64>" } }`，editor → 201 `{ flow }`。根目录要有 `flow.json` 或 `flow.md`。/ The root needs `flow.json` or `flow.md`. |
| GET | `/api/flows/:flow` | `{ flow, role }` |
| PATCH | `/api/flows/:flow` | `{ name }`，editor |
| DELETE | `/api/flows/:flow` | owner；文件和 `runs/` 一起删 / deletes the files and `runs/` too |
| GET | `/api/flows/:flow/files` | `{ files: [{ path, size, sha256 }] }`：每个文件（含 `runs/`），给命令行同步用 / every file (including `runs/`), for the CLI to sync |
| GET | `/api/flows/:flow/raw?path=` | 文件内容 / the file's bytes |
| PUT | `/api/flows/:flow/raw?path=` | 请求体就是内容 / the body is the content，editor → `{ ok, path, size, sha256 }` |
| DELETE | `/api/flows/:flow/raw?path=` | 文件或文件夹 / a file or folder，editor |
| GET | `/api/flows/:flow/events` | WebSocket，见下 / see below |

路径是相对流程文件夹的 posix 路径；绝对路径、`..`、`\`、`.git/` 和 `.flowgit-blobs/` 一律 400。

Paths are posix paths relative to the flow folder; absolute paths, `..`, `\`, `.git/` and `.flowgit-blobs/` are refused with 400.

### 看板接口 / The board API

`/api/flows/:flow/board/<route>` 和本机看板的 `/api/<route>` 完全一样（同样的参数、状态码和返回体，见 `CLAUDE.md` 里 `packages/web` 的说明）。云端直接复用网页版的 `BrowserBoard`（`packages/app/src/router.ts`），所以网页版只要把看板的请求从 `/api/<route>` 改发到 `/api/flows/<id>/board/<route>`。读取要 viewer，其余要 editor。

`/api/flows/:flow/board/<route>` is exactly the local board's `/api/<route>` (same parameters, statuses and bodies; see `packages/web` in `CLAUDE.md`). The cloud reuses the web app's `BrowserBoard` (`packages/app/src/router.ts`), so the web app only has to send the board's requests to `/api/flows/<id>/board/<route>` instead of `/api/<route>`. Reads need viewer; everything else needs editor.

- 可以用 / Available: `GET flow`、`GET graph`、`GET usage`、`GET plan`、`GET`/`PUT inputs`、`GET`/`PUT file`、`POST upload`、`GET thumb`、`GET runs`、`GET diff`、`POST restore`、`POST`/`PUT`/`DELETE stage`、`PUT flow`。版本、对比和回退就是 core 的 `listRuns`、`diffRuns`、`restoreStage`。/ Versions, diffs and restores are core's `listRuns`, `diffRuns` and `restoreStage`.
- 还不能用 / Not yet: `POST run` 和 `POST trust` 返回 501，等云端运行（#170）。现在请在电脑上运行，再用命令行推上来。/ `POST run` and `POST trust` answer 501 until cloud runs (#170). For now, run on a computer and push with the CLI.

### 实时通知 / Live events

`GET /api/flows/:flow/events` 升级成 WebSocket（viewer 就行；带 cookie 时 `Origin` 必须是本站）。每条消息是 JSON，形状和本机看板 SSE 的一帧一样：

`GET /api/flows/:flow/events` upgrades to a WebSocket (viewer is enough; with a cookie, `Origin` must be this site). Each message is JSON shaped like one frame of the local board's SSE:

```json
{ "id": 1762214400000, "event": "flow:changed", "data": {} }
```

- 连上时先收到 `hello`（`data.flow` 是流程 id）。/ `hello` comes first on connect (`data.flow` is the flow id).
- 任何人改了这个流程的文件，所有打开它的人都会收到 `flow:changed`，看板收到后重新读取（本机看板本来就这样处理）。/ When anyone changes the flow's files, everyone with it open gets `flow:changed`, and the board reloads, as it already does locally.
- 发 `ping` 回 `pong`。#173 会在这里加在线、锁和评论，#170 加运行日志。/ Send `ping` to get `pong`. #173 adds presence, locks and comments here, and #170 the run log.

## 限制 / Limits

| 什么 / What | 上限 / Limit |
| --- | --- |
| 一个文件或一次上传 / one file or upload | 50 MB（413） |
| 一次建流程的 `files` 合计 / `files` when creating a flow | 50 MB；更大的文件建好后再一个个上传 / upload bigger ones one by one afterwards |
| 一个流程的文件数（含 `runs/`）/ files per flow (incl. `runs/`) | 5000 |
| 每个工作区的空间 / storage per workspace | 2 GB（413） |
| 每个工作区的流程 / flows per workspace | 200 |
| 请求频率 / request rate | 每人每分钟 600 次；登录相关每个 IP 每分钟 20 次（429）/ 600 per person per minute; sign-in routes 20 per IP per minute |

大于 4 MB 的文件（视频、音频、大图）不放进内存：内容按 SHA-256 存一份，流程里的文件只记一个小引用，读的时候直接从存储返回完整内容。`files` 列表里的 `size` 和 `sha256` 是真实内容的。

Files over 4 MB (video, audio, big pictures) stay out of memory: the content is stored once by SHA-256 and the flow's file holds a small reference; reads return the full content straight from storage. `size` and `sha256` in the `files` list are those of the real content.

## 怎么存 / How it is stored

- **D1**：用户、登录方式、会话（只存令牌的哈希）、工作区、成员、邀请码（只存哈希）、流程清单、设备码、操作记录。迁移文件在 `packages/server/migrations/`。/ users, sign-in identities, sessions (token hashes only), workspaces, members, invite codes (hashes only), the flow list, device codes and the audit log. Migrations are in `packages/server/migrations/`.
- **R2**：每个文件一个对象，`flows/<流程 id>/<路径>`；空文件夹是结尾带 `/` 的空对象；大文件在 `flows/<流程 id>/.flowgit-blobs/<sha256>`。/ one object per file at `flows/<flow id>/<path>`; empty folders are empty objects whose key ends in `/`; large files live at `flows/<flow id>/.flowgit-blobs/<sha256>`.
- **房间 / Rooms**：每个流程一个 Durable Object（`FlowRoom`），把流程载进 core 的内存 Host，按顺序把改动写回 R2，写完才回答请求，再通知打开这个流程的人。core 的当前 Host 用 `AsyncLocalStorage` 按请求区分，同时处理的请求不会串。/ one Durable Object (`FlowRoom`) per flow loads the flow into core's memory host, writes changes back to R2 in order, answers only once they are stored, then tells everyone with the flow open. Core's current host is kept per request with `AsyncLocalStorage`, so concurrent requests never mix.
- **操作记录 / Audit log**：登录、注册、建删流程、写文件、上传、回退、改阶段、邀请和成员变动都会记下是谁、什么时候、哪个文件，不记文件内容和密钥。/ sign-ins, sign-ups, creating and deleting flows, file writes, uploads, restores, stage edits, invites and member changes are recorded with who, when and which file, never file contents or secrets.

## 测试控制台 / Test console

`/api/console/` 是一个很小的网页（`packages/server/static/console/`），在网页版接上云端（#172）之前用来手动检查 staging：登录、建工作区、邀请、放模板或上传电脑上的流程文件夹（连同 `runs/`）、看版本和对比。

`/api/console/` is a small page (`packages/server/static/console/`) for checking staging by hand until the web app is connected (#172): sign in, create a workspace, invite people, add a template or upload a flow folder from the computer (with its `runs/`), and look at versions and diffs.

## 部署和设置 / Deploying and setup

- `.github/workflows/server.yml`：推到 `main` 部署 staging；正式环境手动运行。仓库没有 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 时跳过，不算失败。`packages/server/scripts/deploy.mjs` 第一次会建 D1 数据库（`flowgit-staging` / `flowgit-production`）和 R2 桶（`flowgit-files-staging` / `flowgit-files-production`），然后执行迁移再部署。/ deploys staging on every push to `main` and production by hand; it skips without failing when the repository has no `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The first time, `packages/server/scripts/deploy.mjs` creates the D1 database and the R2 bucket, then applies migrations and deploys.
- Worker 的 secret（在 Cloudflare 后台 Workers & Pages → Worker → Settings → Variables and Secrets 填，不进仓库）：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。/ Worker secrets, set in the Cloudflare dashboard and never committed.
- OAuth 回调地址 / OAuth callback URLs：`https://<host>/api/auth/github/callback`、`https://<host>/api/auth/google/callback`（`<host>` 是 `flowgit.dev` 或 `staging.flowgit.dev`）。
- 测试在 Cloudflare 官方的本机模拟环境里跑（`@cloudflare/vitest-plugin`），不连真的 Cloudflare：`pnpm --filter @flowgit/server test`。/ Tests run in Cloudflare's official local emulator (`@cloudflare/vitest-plugin`) and never reach the real Cloudflare.
