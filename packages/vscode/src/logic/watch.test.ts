import { describe, expect, it, vi } from "vitest";
import { spawnCaptured } from "./spawn.js";
import { REFRESH_DEBOUNCE_MS, affectsFlow, debounce } from "./watch.js";

describe("spawnCaptured", () => {
  it("passes arguments with spaces through as separate argv entries", async () => {
    const result = await spawnCaptured(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", "my stage", "C:\\My Flows"], process.cwd());
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["my stage", "C:\\My Flows"]);
  });
});

describe("refresh debounce", () => {
  it("runs once after a burst of file events", () => {
    vi.useFakeTimers();
    let runs = 0;
    const timer = debounce(() => {
      runs++;
    }, REFRESH_DEBOUNCE_MS);
    timer.call();
    timer.call();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
    expect(runs).toBe(0);
    vi.advanceTimersByTime(1);
    expect(runs).toBe(1);
    timer.cancel();
    timer.call();
    timer.cancel();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(runs).toBe(1);
    vi.useRealTimers();
  });

  it("ignores node_modules, .git and .flowgit, and still notices runs/", () => {
    expect(affectsFlow("/repo/runs/draft/1/run.json")).toBe(true);
    expect(affectsFlow("/repo/flow.json")).toBe(true);
    expect(affectsFlow("/repo/node_modules/pkg/flow.json")).toBe(false);
    expect(affectsFlow("/repo/.git/flow.json")).toBe(false);
    expect(affectsFlow("/repo/.flowgit/thumbs/a.png")).toBe(false);
    expect(affectsFlow("C:\\repo\\runs\\draft\\run.json")).toBe(true);
    expect(affectsFlow("C:\\repo\\node_modules\\flow.json")).toBe(false);
  });
});
