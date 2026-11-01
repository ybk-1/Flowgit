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
