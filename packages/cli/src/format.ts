import type { StageState, StageStatus } from "@flowgit/core";
import { outputRel } from "@flowgit/core";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  cyan: wrap(36),
};

const STATE_LABEL: Record<StageState, { icon: string; zh: string; color: (s: string) => string }> = {
  ok: { icon: "✓", zh: "已完成", color: c.green },
  stale: { icon: "↻", zh: "需重跑（上游或配置变了）", color: c.yellow },
  edited: { icon: "✎", zh: "产物被手动修改", color: c.cyan },
  error: { icon: "✗", zh: "上次运行失败", color: c.red },
  "never-run": { icon: "○", zh: "可以运行", color: c.blue },
  "waiting-upstream": { icon: "…", zh: "等上游", color: c.dim },
};

export function stateLabel(state: StageState): string {
  const l = STATE_LABEL[state];
  return l.color(`${l.icon} ${l.zh} (${state})`);
}

/** Display width: CJK characters take two columns. */
export function width(s: string): number {
  // eslint-disable-next-line no-control-regex
  const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of plain) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}

export function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - width(s)));
}

export function table(rows: string[][]): string {
  const widths: number[] = [];
  for (const r of rows) r.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, width(cell))));
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : pad(cell, widths[i]))).join("  ")).join("\n");
}

export function statusBoard(statuses: StageStatus[]): string {
  const rows = [[c.dim("#"), c.dim("阶段 stage"), c.dim("执行 executor"), c.dim("状态 state"), c.dim("版本 runs"), c.dim("产物 outputs")]];
  statuses.forEach((s, i) => {
    rows.push([
      String(i + 1),
      `${s.stage.name} ${c.dim(s.stage.id)}`,
      s.stage.executor.type,
      stateLabel(s.state),
      s.latest ? `v${s.latest.n}${s.runs > 1 ? c.dim(` /${s.runs}`) : ""}` : "-",
      s.stage.outputs.map((o) => outputRel(o)).join(", "),
    ]);
  });
  return table(rows);
}

function ansi(code: number, s: string): string {
  return `\x1b[${code}m${s}\x1b[0m`;
}

/**
 * Color a unified diff: added lines green, removed lines red.
 * `---` / `+++` file headers stay plain. Set `enabled` to force a decision;
 * otherwise color follows a TTY and is off when NO_COLOR is set.
 */
export function colorizeUnifiedDiff(patch: string, enabled?: boolean): string {
  const on = enabled ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
  let minusHeader = false;
  let plusHeader = false;
  return patch
    .split("\n")
    .map((line) => {
      if (!minusHeader && line.startsWith("--- ")) {
        minusHeader = true;
        return line;
      }
      if (!plusHeader && line.startsWith("+++ ")) {
        plusHeader = true;
        return line;
      }
      if (!on) return line;
      if (line.startsWith("+")) return ansi(32, line);
      if (line.startsWith("-")) return ansi(31, line);
      return line;
    })
    .join("\n");
}

export function nextHint(statuses: StageStatus[]): string | undefined {
  const next = statuses.find((s) => s.state !== "ok" && s.state !== "edited" && s.state !== "waiting-upstream");
  if (!next) {
    return statuses.every((s) => s.state === "ok" || s.state === "edited") ? "全部完成。All stages are up to date." : undefined;
  }
  if (next.stage.executor.type === "human") {
    const ins = next.stage.executor.instructions ? `\n  ${next.stage.executor.instructions}` : "";
    return `下一步：「${next.stage.name}」需要你来做。Next: "${next.stage.id}" is yours.${ins}\n  完成后运行 / then run: flowgit run ${next.stage.id}`;
  }
  return `下一步 / next: flowgit run ${next.stage.id}   (或 / or: flowgit run all)`;
}

/**
 * Commander's own errors (unknown command, missing argument …), made bilingual
 * like the rest of the CLI. Anything not recognised is passed through as is.
 */
export function bilingualCliError(raw: string): string {
  const [first, ...rest] = raw.trimEnd().split("\n");
  const rules: [RegExp, (...m: string[]) => string][] = [
    [/^error: unknown command '(.+)'$/, (a) => `没有这个命令 ${a} / unknown command '${a}'`],
    [/^error: unknown option '(.+)'$/, (a) => `没有这个选项 ${a} / unknown option '${a}'`],
    [/^error: missing required argument '(.+)'$/, (a) => `缺少参数 ${a} / missing required argument '${a}'`],
    [/^error: option '(.+)' argument missing$/, (a) => `选项 ${a} 后面要写一个值 / option '${a}' needs a value`],
    [
      /^error: too many arguments for '(.+)'\. Expected (\d+) arguments? but got (\d+)(?::.*)?\.$/,
      (cmd, want, got) => `${cmd} 只要 ${want} 个参数，给了 ${got} 个 / ${cmd} takes ${want} argument(s), got ${got}`,
    ],
  ];
  const rule = rules.find(([re]) => re.test(first));
  if (!rule) return raw;
  const m = first.match(rule[0])!;
  const lines = [`${c.red("✗")} ${rule[1](...m.slice(1))}`];
  for (const line of rest) {
    const guess = line.match(/^\(Did you mean (.+)\?\)$/);
    lines.push(guess ? `  是不是想输入 ${guess[1]}？/ did you mean ${guess[1]}?` : line);
  }
  lines.push(c.dim("  加 --help 看用法 / add --help for usage"));
  return `${lines.join("\n")}\n`;
}
