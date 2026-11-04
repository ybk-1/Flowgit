import fs from "node:fs";
import path from "node:path";
import { doctor, loadFlow, type DoctorCheck } from "@flowgit/core";

/**
 * Home-page doctor: the same `doctor()` the CLI runs, on a small flow that asks
 * for ffmpeg and the agent CLIs. Nothing here is bundled with the app.
 */
export function writeDoctorProbe(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), "Desktop doctor probe.\n");
  const agents = ["claude-code", "codex", "cursor", "gemini"] as const;
  const stages = [
    {
      id: "ffmpeg",
      name: "ffmpeg",
      executor: { type: "script", run: "ffmpeg -version" },
      outputs: [{ type: "text/plain", path: "ffmpeg.txt" }],
    },
    ...agents.map((agent) => ({
      id: agent,
      name: agent,
      executor: { type: "agent", agent, prompt: "prompt.md" },
      outputs: [{ type: "text/plain", path: `${agent}.txt` }],
    })),
  ];
  fs.writeFileSync(
    path.join(dir, "flow.json"),
    JSON.stringify({ format: "flowgit", version: "0.1", name: "desktop doctor", stages }),
  );
}

export async function machineDoctor(dir: string, env: NodeJS.ProcessEnv = process.env): Promise<DoctorCheck[]> {
  writeDoctorProbe(dir);
  return doctor(loadFlow(dir), { env });
}
