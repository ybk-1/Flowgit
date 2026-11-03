import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TrustChangedError,
  TrustNeededError,
  doctor,
  listRuns,
  loadFlow,
  runAll,
  runStage,
  trustFile,
  trustFlow,
  trustState,
  type Flow,
} from "./index.js";

const dirs: string[] = [];
let home: string;
const savedHome = process.env.FLOWGIT_HOME;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  home = tmp("flowgit-trust-home-");
  process.env.FLOWGIT_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.FLOWGIT_HOME;
  else process.env.FLOWGIT_HOME = savedHome;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function write(dir: string, rel: string, content: string | object): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

const FORKED = { source: "https://example.com/someone/flow.git", commit: "abc123" };

function scriptFlow(run: string, forked = true): Flow {
  return {
    format: "flowgit",
    version: "0.1",
    name: "copied",
    ...(forked ? { forkedFrom: FORKED } : {}),
    stages: [
      {
        id: "make",
        name: "Make",
        executor: { type: "script", run },
        outputs: [{ type: "text/plain", path: "out.txt" }],
      },
    ],
  };
}

const MAKE_JS = `require("node:fs").writeFileSync("out.txt", "made\\n");`;

describe("confirming a copied flow before its first run", () => {
  it("needs nothing for a flow that was not copied from a Git URL", async () => {
    const dir = tmp("flowgit-trust-");
    write(dir, "make.cjs", MAKE_JS);
    write(dir, "flow.json", scriptFlow("node make.cjs", false));
    const loaded = loadFlow(dir);
    expect(trustState(loaded)).toMatchObject({ needed: false, reason: "not-forked" });
    await runStage(loaded, "make");
    expect(fs.readFileSync(path.join(dir, "out.txt"), "utf8")).toBe("made\n");
  });

  it("needs nothing for a copied flow that only calls models or waits for people", () => {
    const dir = tmp("flowgit-trust-");
    write(dir, "flow.json", {
      format: "flowgit",
      version: "0.1",
      name: "copied",
      forkedFrom: FORKED,
      stages: [{ id: "notes", name: "Notes", executor: { type: "human" }, outputs: [{ type: "text/plain", path: "notes.md" }] }],
    });
    expect(trustState(loadFlow(dir))).toMatchObject({ needed: false, reason: "no-actions", actions: [] });
  });

  it("refuses to run a copied flow until it is confirmed, then remembers it outside the flow", async () => {
    const dir = tmp("flowgit-trust-");
    write(dir, "make.cjs", MAKE_JS);
    write(dir, "flow.json", scriptFlow("node make.cjs"));
    const loaded = loadFlow(dir);

    const state = trustState(loaded);
    expect(state).toMatchObject({ needed: true, reason: "new", source: FORKED.source, actions: [{ stage: "make", kind: "script", detail: "node make.cjs" }] });
    expect(state.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    const refused = await runStage(loaded, "make").catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(TrustNeededError);
    expect((refused as TrustNeededError).message).toContain("flowgit trust");
    expect((refused as TrustNeededError).message).toContain(FORKED.source);
    await expect(runAll(loaded)).rejects.toBeInstanceOf(TrustNeededError);
    // nothing ran and nothing was recorded
    expect(fs.existsSync(path.join(dir, "out.txt"))).toBe(false);
    expect(listRuns(dir, "make")).toEqual([]);

    expect(trustFlow(loaded, state.fingerprint)).toMatchObject({ needed: false, reason: "trusted" });
    expect(trustState(loaded)).toMatchObject({ needed: false, reason: "trusted" });
    // stored under FLOWGIT_HOME, never in the flow directory
    expect(trustFile()).toBe(path.join(home, "trusted.json"));
    const stored = JSON.parse(fs.readFileSync(trustFile(), "utf8")) as { flows: Record<string, { fingerprint: string; source: string }> };
    expect(Object.values(stored.flows)).toEqual([expect.objectContaining({ fingerprint: state.fingerprint, source: FORKED.source })]);
    expect(fs.readdirSync(dir).sort()).toEqual(["flow.json", "make.cjs"]);

    await runAll(loaded);
    expect(fs.readFileSync(path.join(dir, "out.txt"), "utf8")).toBe("made\n");
  });

  it("asks again only when the commands change, and won't confirm a list the person didn't see", async () => {
    const dir = tmp("flowgit-trust-");
    write(dir, "make.cjs", MAKE_JS);
    write(dir, "flow.json", scriptFlow("node make.cjs"));
    const first = trustState(loadFlow(dir));
    trustFlow(loadFlow(dir), first.fingerprint);

    // editing the script file is not a new command
    write(dir, "make.cjs", `${MAKE_JS}\n// tweak\n`);
    expect(trustState(loadFlow(dir)).needed).toBe(false);

    write(dir, "flow.json", scriptFlow("node make.cjs --again"));
    const changed = loadFlow(dir);
    expect(trustState(changed)).toMatchObject({ needed: true, reason: "changed" });
    const refused = await runStage(changed, "make").catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(TrustNeededError);
    expect((refused as Error).message).toContain("不一样了");

    // the old list is not the one on disk any more
    expect(() => trustFlow(changed, first.fingerprint)).toThrow(TrustChangedError);
    expect(trustState(changed).needed).toBe(true);
    trustFlow(changed, trustState(changed).fingerprint);
    expect(trustState(changed).needed).toBe(false);
  });

  it("lists a sub-flow's commands under the parent, and runs the sub-flow under the parent's confirmation", async () => {
    const dir = tmp("flowgit-trust-");
    const sub: Flow = { ...scriptFlow("node make.cjs"), name: "inner", forkedFrom: { source: "https://example.com/other.git" } };
    write(dir, "inner/make.cjs", MAKE_JS);
    write(dir, "inner/flow.json", sub);
    write(dir, "flow.json", {
      format: "flowgit",
      version: "0.1",
      name: "outer",
      forkedFrom: FORKED,
      stages: [
        {
          id: "nest",
          name: "Nest",
          executor: { type: "workflow", engine: "flowgit", file: "inner/flow.json", params: { copy: { "out.txt": "out.txt" } } },
          outputs: [{ type: "text/plain", path: "out.txt" }],
        },
      ],
    });
    const loaded = loadFlow(dir);
    const state = trustState(loaded);
    expect(state.actions.map((a) => `${a.kind} ${a.stage}`)).toEqual(["workflow nest", "script nest/make"]);
    trustFlow(loaded, state.fingerprint);
    await runStage(loaded, "nest");
    expect(fs.readFileSync(path.join(dir, "out.txt"), "utf8")).toBe("made\n");

    // a new command inside the sub-flow changes the parent's list
    write(dir, "inner/flow.json", { ...sub, stages: [{ ...sub.stages[0], executor: { type: "script", run: "node make.cjs --more" } }] });
    expect(trustState(loadFlow(dir))).toMatchObject({ needed: true, reason: "changed" });
  });

  it("reaches the same confirmation through a symlinked path", () => {
    if (process.platform === "win32") return; // symlinks need extra rights on Windows
    const dir = tmp("flowgit-trust-");
    write(dir, "flow.json", scriptFlow("node make.cjs"));
    const link = path.join(tmp("flowgit-trust-link-"), "via");
    fs.symlinkSync(dir, link);
    trustFlow(loadFlow(link), trustState(loadFlow(link)).fingerprint);
    expect(trustState(loadFlow(dir)).needed).toBe(false);
  });

  it("doctor warns until the copied flow is confirmed", () => {
    const dir = tmp("flowgit-trust-");
    write(dir, "flow.json", scriptFlow("node make.cjs"));
    const env = { ...process.env, FLOWGIT_HOME: home };
    const before = doctor(loadFlow(dir), { env }).find((check) => check.message.includes(FORKED.source));
    expect(before).toMatchObject({ level: "warn", hint: expect.stringContaining("flowgit trust") });
    trustFlow(loadFlow(dir), undefined, env);
    const after = doctor(loadFlow(dir), { env }).find((check) => check.message.includes(FORKED.source));
    expect(after).toMatchObject({ level: "ok" });
  });

  it("says how to fix a broken trusted.json instead of trusting or crashing", () => {
    const dir = tmp("flowgit-trust-");
    write(dir, "flow.json", scriptFlow("node make.cjs"));
    fs.writeFileSync(path.join(home, "trusted.json"), "{ nope");
    expect(() => trustState(loadFlow(dir))).toThrow(/trusted\.json.*not valid JSON/);
  });
});
