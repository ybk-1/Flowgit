import fs from "node:fs";
import path from "node:path";
import type { ExecutorHuman } from "../types.js";
import { copyPath, outputRel } from "../util.js";
import { HumanInputNeededError, type ExecContext, type ExecResult, type StageExecutor } from "./types.js";

/**
 * A person produces the artifacts by hand. Running the stage either copies the
 * files given with --from into place, or simply records what is already there.
 * If anything declared is missing, the stage reports what it is waiting for.
 */
export const humanExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const { stage, loaded } = ctx;
    const ex = stage.executor as ExecutorHuman;
    const from = ctx.options.from ?? [];
    if (from.length > stage.outputs.length) {
      throw new Error(`--from 给了 ${from.length} 个路径，但「${stage.name}」只有 ${stage.outputs.length} 个产物 / --from got ${from.length} paths but stage "${stage.id}" declares ${stage.outputs.length} output(s)`);
    }
    from.forEach((src, i) => {
      const out = stage.outputs[i];
      const abs = path.resolve(src);
      if (!fs.existsSync(abs)) throw new Error(`--from 的路径不存在 / --from path not found: ${src}`);
      const dst = path.join(loaded.dir, outputRel(out));
      if (path.resolve(dst) !== abs) {
        fs.rmSync(dst, { recursive: true, force: true });
        copyPath(abs, dst);
        ctx.log(`已复制 / copied ${src} -> ${outputRel(out)}`);
      }
    });
    const missing = stage.outputs
      .map((o) => outputRel(o))
      .filter((rel) => !fs.existsSync(path.join(loaded.dir, rel)));
    if (missing.length) {
      throw new HumanInputNeededError(stage, missing, ex.instructions);
    }
    return { params: { provided: from.length ? "from" : "existing" } };
  },
};
