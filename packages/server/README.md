# @flowgit/server

Flowgit 云端，跑在 Cloudflare Workers（D1、R2、Durable Objects、Workflows）。接口见 [`docs/cloud.md`](../../docs/cloud.md)。不发布到 npm。

Flowgit Cloud on Cloudflare Workers (D1, R2, Durable Objects, Workflows). The API is in [`docs/cloud.md`](../../docs/cloud.md). Not published to npm.

```bash
pnpm --filter @flowgit/server test    # 本机模拟环境里的测试 / tests in the local emulator
pnpm --filter @flowgit/server build   # 打包检查 / bundle check (wrangler deploy --dry-run)
# 本机试用：先建 .dev.vars 写一行 FLOWGIT_TEST_LOGIN=1，然后 / to try it locally, put FLOWGIT_TEST_LOGIN=1 in .dev.vars, then:
pnpm --filter @flowgit/server exec wrangler d1 migrations apply DB --local
pnpm --filter @flowgit/server dev     # http://localhost:8787/api/console/
```
