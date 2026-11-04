import { escapeHtml, SECURITY_HEADERS } from "./http.js";

/** A plain bilingual page with no scripts (sign-in results, the CLI's device approval). */
export function page(title: string, body: string, status = 200, headers: Record<string, string> = {}): Response {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Flowgit</title>
<style>
  :root { color-scheme: light dark; --fg: #111; --bg: #fafaf7; --muted: #666; --line: #ddd; }
  @media (prefers-color-scheme: dark) { :root { --fg: #eee; --bg: #151515; --muted: #999; --line: #333; } }
  body { margin: 0; font: 16px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 34rem; margin: 12vh auto; padding: 0 16px; }
  h1 { font-size: 1.4rem; }
  .button, button { display: inline-block; margin: 0 .5rem .5rem 0; padding: .55rem 1rem; border: 1px solid var(--fg); border-radius: 6px; color: var(--fg); background: none; text-decoration: none; font: inherit; cursor: pointer; }
  input { font: 1.4rem ui-monospace, monospace; letter-spacing: .15em; padding: .4rem .6rem; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--fg); }
  .muted { color: var(--muted); font-size: .9rem; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...SECURITY_HEADERS,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      ...headers,
    },
  });
}
