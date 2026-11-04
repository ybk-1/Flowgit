import type { Command } from "commander";
import { runFlowTests, type FlowTestReport } from "@flowgit/core";
import { c } from "../format.js";

/**
 * `flowgit test [names...] [--live] [--model] [--json] [--keep]`
 * Runs tests/<name>.json in a temporary copy. One ✓ or ✗ line per case.
 */
export function registerTest(program: Command, dirOf: () => string, fail: (err: unknown) => never): void {
  program
    .command("test")
    .description("用 tests/ 里的用例跑流程并检查产物 / run the cases in tests/ and check the outputs")
    .argument("[names...]", "只跑这些用例（文件名或 name）/ only these cases (file name or name)")
    .option("--live", "调用真的模型；默认只用固定回复 / call real models; the default uses canned replies only")
    .option("--model <model>", "和 --live 一起用：<模型> 或 <供应商>/<模型> / with --live: <model> or <provider>/<model>")
    .option("--json", "输出 JSON / machine-readable output")
    .option("--keep", "保留临时副本并打印路径 / keep the temporary copy and print its path")
    .action(async (names: string[], opts: { live?: boolean; model?: string; json?: boolean; keep?: boolean }) => {
      if (opts.model && !opts.live) fail(new Error("--model 要和 --live 一起用 / --model is only used with --live"));
      try {
        const report = await runFlowTests(dirOf(), {
          ...(names.length ? { names } : {}),
          ...(opts.live ? { live: true } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.keep ? { keep: true } : {}),
          onPlan: opts.json
            ? undefined
            : ({ modelCalls }) => {
                console.log(`最多 ${modelCalls} 次模型调用 / at most ${modelCalls} model call(s)`);
              },
        });
        if (opts.json) console.log(JSON.stringify(report, null, 2));
        else printReport(report, !!opts.keep);
        if (!report.ok) process.exitCode = 1;
      } catch (err) {
        if (opts.json) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(JSON.stringify({ ok: false, error: message }, null, 2));
          process.exitCode = 1;
          return;
        }
        fail(err);
      }
    });
}

function printReport(report: FlowTestReport, keep: boolean): void {
  if (!report.cases.length) {
    console.log("没有测试用例。在 tests/ 下放一个 <名字>.json / No test cases. Add <name>.json under tests/");
    return;
  }
  for (const item of report.cases) {
    const label = item.name === item.id ? item.id : `${item.name} ${c.dim(`(${item.id})`)}`;
    console.log(`${item.ok ? c.green("✓") : c.red("✗")} ${label}`);
    if (item.error) {
      for (const line of item.error.split(/\r?\n/)) console.log(`  ${line}`);
    }
    for (const check of item.checks) {
      if (check.ok) continue;
      console.log(`  ${check.stage} ${check.file}`);
      console.log(`    期望 / expected: ${check.expected}`);
      console.log(`    实际 / actual: ${showActual(check.actual ?? "")}`);
    }
    if (keep && item.dir) console.log(`  保留临时目录 / kept temporary directory: ${item.dir}`);
  }
}

function showActual(actual: string): string {
  return actual.replace(/\r?\n/g, "\\n");
}
