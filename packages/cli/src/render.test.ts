import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the short-video template's export script directly on tiny timelines.
const here = path.dirname(fileURLToPath(import.meta.url));
const template = path.resolve(here, "..", "templates", "short-video");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

function probe(file: string, entries: string, stream?: string): string {
  const args = ["-v", "error", ...(stream ? ["-select_streams", stream] : []), "-show_entries", entries, "-of", "csv=p=0", file];
  return spawnSync("ffprobe", args, { encoding: "utf8" }).stdout.trim();
}

describe.skipIf(!hasFfmpeg)("short-video export script", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-render-"));
    fs.cpSync(path.join(template, "scripts"), path.join(dir, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(dir, "assets"));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function render(timeline: object) {
    fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify({ width: 360, height: 640, fps: 15, ...timeline }));
    const r = spawnSync(process.execPath, [path.join(dir, "scripts", "render.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, FLOWGIT_PROJECT_DIR: dir, FLOWGIT_FLOW_INPUTS: JSON.stringify({ language: "en" }) },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  const cards = [
    { id: "s1", duration: 2, source: { kind: "card" }, caption: "one", narration: "first card" },
    { id: "s2", duration: 2, source: { kind: "card" }, caption: "two", narration: "second card" },
  ];

  it("adds looped background music cut to the video's length", () => {
    // 1.5 s of tone: shorter than the 4 s video, so it has to loop
    const tone = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", path.join(dir, "assets", "music.wav")]);
    expect(tone.status).toBe(0);
    const r = render({ title: "Music", music: { path: "assets/music.wav", volume: 0.5 }, clips: cards });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("music: assets/music.wav, volume 0.5");
    const final = path.join(dir, "final.mp4");
    expect(probe(final, "stream=codec_type", "a")).toBe("audio");
    expect(Number(probe(final, "format=duration"))).toBeCloseTo(4, 0);
    expect(Number(probe(final, "stream=duration", "a"))).toBeCloseTo(4, 0);
  });

  it("exports without sound, and says so, when the music file is missing", () => {
    const r = render({ music: { path: "assets/nope.mp3" }, transition: { type: "none" }, clips: cards });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("music assets/nope.mp3 not found");
    expect(probe(path.join(dir, "final.mp4"), "stream=codec_type", "a")).toBe("");
  });
});
