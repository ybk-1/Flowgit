import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { machineDoctor } from "./doctor-machine.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("machine doctor", () => {
  it("reports ffmpeg and the agent CLIs through flowgit doctor", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-desktop-doctor-"));
    dirs.push(dir);
    const checks = await machineDoctor(dir, { ...process.env, FLOWGIT_HOME: dir });
    const messages = checks.map((check) => check.message).join("\n");
    expect(messages).toContain("ffmpeg");
    expect(messages).toMatch(/claude|codex|agent|gemini/);
    expect(checks.some((check) => check.hint)).toBe(true);
  });
});
