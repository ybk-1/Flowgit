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

  function tone(name: string, seconds: number, hz = 440) {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${seconds}`, path.join(dir, "assets", name)]);
    expect(r.status).toBe(0);
  }

  function buildTimeline(storyboard: object) {
    fs.writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(storyboard));
    const r = spawnSync(process.execPath, [path.join(dir, "scripts", "build-timeline.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, FLOWGIT_PROJECT_DIR: dir, FLOWGIT_FLOW_INPUTS: JSON.stringify({ language: "en" }) },
    });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    return { out: `${r.stdout}${r.stderr}`, timeline: JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8")) };
  }

  it("fits the clips to a voiceover and mixes it over quieter music", () => {
    tone("voice.wav", 5, 300);
    tone("music.wav", 1.5);
    const { out, timeline } = buildTimeline({
      title: "Voice",
      shots: [
        { id: "s1", duration: 3, caption: "a", narration: "one two" },
        { id: "s2", duration: 3, caption: "b", narration: "three four five six seven eight" },
      ],
    });
    expect(out).toContain("voiceover voice.wav, music music.wav");
    expect(out).toContain("fitted to the voiceover (shared by each clip's narration length)");
    expect(timeline.voice).toEqual({ path: "assets/voice.wav", volume: 1 });
    expect(timeline.music).toEqual({ path: "assets/music.wav", volume: 0.2 });
    // 5 s of voice + 0.6 s tail, shared 6 : 26 by narration length (spaces don't count).
    expect(timeline.duration).toBeCloseTo(5.6, 1);
    expect(timeline.clips[0].duration).toBeCloseTo(1.05, 2);
    expect(timeline.clips[1].duration).toBeCloseTo(4.55, 2);
    expect(timeline.clips[1].start).toBeCloseTo(1.05, 2);

    const r = render({ ...timeline, width: 360, height: 640, fps: 15 });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("voiceover: assets/voice.wav, volume 1");
    expect(r.out).toContain("music: assets/music.wav, volume 0.2");
    const final = path.join(dir, "final.mp4");
    expect(Number(probe(final, "format=duration"))).toBeCloseTo(5.6, 0);
    expect(Number(probe(final, "stream=duration", "a"))).toBeCloseTo(5.6, 0);
  });

  it("warns when the voiceover runs longer than the video", () => {
    tone("voice.wav", 6, 300);
    const r = render({ voice: { path: "assets/voice.wav" }, transition: { type: "none" }, clips: cards });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("2.0s longer than the video");
    const final = path.join(dir, "final.mp4");
    expect(probe(final, "stream=codec_type", "a")).toBe("audio");
    expect(Number(probe(final, "stream=duration", "a"))).toBeCloseTo(4, 0);
  });

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

describe("short-video timeline voiceover choice", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "flowgit-voice-choice-"));
    fs.cpSync(path.join(template, "scripts"), path.join(dir, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(
      path.join(dir, "storyboard.json"),
      JSON.stringify({
        title: "Voice",
        shots: [
          { id: "s1", duration: 3, caption: "a", narration: "one two" },
          { id: "s2", duration: 3, caption: "b", narration: "three" },
        ],
      }),
    );
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function build() {
    const r = spawnSync(process.execPath, [path.join(dir, "scripts", "build-timeline.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, FLOWGIT_PROJECT_DIR: dir, FLOWGIT_FLOW_INPUTS: JSON.stringify({ language: "en" }) },
    });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    return {
      out: `${r.stdout}${r.stderr}`,
      timeline: JSON.parse(fs.readFileSync(path.join(dir, "timeline.json"), "utf8")) as { voice?: { path: string } },
    };
  }

  it("uses voice/voice.mp3 when nothing was recorded in assets/", () => {
    fs.mkdirSync(path.join(dir, "voice"));
    fs.writeFileSync(path.join(dir, "voice", "voice.mp3"), "not really audio");
    const { out, timeline } = build();
    expect(timeline.voice).toEqual({ path: "voice/voice.mp3", volume: 1 });
    expect(out).toContain("voiceover voice/voice.mp3");
  });

  it("prefers a recorded voiceover in assets/ over the generated file", () => {
    fs.mkdirSync(path.join(dir, "voice"));
    fs.writeFileSync(path.join(dir, "voice", "voice.mp3"), "generated");
    fs.writeFileSync(path.join(dir, "assets", "voice.mp3"), "recorded");
    const { out, timeline } = build();
    expect(timeline.voice).toEqual({ path: "assets/voice.mp3", volume: 1 });
    expect(out).toContain("voiceover voice.mp3");
    expect(out).not.toContain("voice/voice.mp3");
  });

  it("ignores the skip note and does not treat it as audio", () => {
    fs.mkdirSync(path.join(dir, "voice"));
    fs.writeFileSync(path.join(dir, "voice", "README.md"), "skipped");
    const { timeline } = build();
    expect(timeline.voice).toBeUndefined();
  });
});
