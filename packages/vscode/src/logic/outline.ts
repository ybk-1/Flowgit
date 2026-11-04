import { parse, type ParseError } from "jsonc-parser";
import { parse as parseYaml } from "yaml";

export interface StageOutline {
  id: string;
  name?: string;
  inputs: string[];
  prompt?: string;
  executor?: string;
  outputs: string[];
}

export interface FlowOutline {
  name?: string;
  stages: StageOutline[];
}

export function parseFlowDocument(text: string, fileName: string): FlowOutline {
  if (fileName === "flow.json" || fileName.endsWith("/flow.json") || fileName.endsWith("\\flow.json")) {
    return outlineFromValue(parseJsonc(text));
  }
  return parseFlowMd(text);
}

function parseJsonc(text: string): unknown {
  const errors: ParseError[] = [];
  return parse(text, errors, { allowTrailingComma: true, disallowComments: false });
}

function outlineFromValue(value: unknown): FlowOutline {
  if (!isRecord(value)) return { stages: [] };
  const name = typeof value.name === "string" ? value.name : undefined;
  const stages = Array.isArray(value.stages) ? value.stages.map(stageFromValue).filter((s): s is StageOutline => s !== undefined) : [];
  return { name, stages };
}

function stageFromValue(value: unknown): StageOutline | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return undefined;
  const exec = isRecord(value.executor) ? value.executor : undefined;
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : undefined,
    inputs: stringList(value.inputs),
    prompt: exec && typeof exec.prompt === "string" ? exec.prompt : undefined,
    executor: exec && typeof exec.type === "string" ? exec.type : undefined,
    outputs: outputPaths(value.outputs),
  };
}

export function parseFlowMd(text: string): FlowOutline {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let name: string | undefined;
  let index = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (end > 0) {
      try {
        const front = parseYaml(lines.slice(1, end).join("\n"));
        if (isRecord(front) && typeof front.name === "string") name = front.name;
      } catch {
        // A broken frontmatter still leaves the headings usable.
      }
      index = end + 1;
    }
  }

  const stages: StageOutline[] = [];
  let fence: { mark: string; len: number } | undefined;
  let section: { name?: string; id?: string; lines: string[] } | undefined;
  const push = () => {
    if (!section) return;
    const stage = stageFromSection(section);
    if (stage) stages.push(stage);
    section = undefined;
  };

  for (; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!fence) {
      const opened = openFence(line);
      if (opened) {
        fence = opened;
        if (section) section.lines.push(line);
        continue;
      }
      const heading = headingOf(line);
      if (heading?.level === 1 && !name && !section) {
        name = heading.text;
        continue;
      }
      if (heading?.level === 2) {
        push();
        section = { name: heading.text, id: heading.id, lines: [] };
        continue;
      }
    } else if (closesFence(line, fence)) {
      if (section) section.lines.push(line);
      fence = undefined;
      continue;
    }
    if (section) section.lines.push(line);
  }
  push();
  return { name, stages };
}

function stageFromSection(section: { name?: string; id?: string; lines: string[] }): StageOutline | undefined {
  const block = flowgitBlock(section.lines);
  let data: Record<string, unknown> = {};
  if (block) {
    try {
      const parsed = parseYaml(block);
      if (isRecord(parsed)) data = parsed;
    } catch {
      data = {};
    }
  }
  const id = section.id || (typeof data.id === "string" ? data.id : undefined);
  if (!id) return undefined;
  const exec = isRecord(data.executor) ? data.executor : undefined;
  const name = section.name || (typeof data.name === "string" ? data.name : undefined);
  return {
    id,
    name: name || undefined,
    inputs: stringList(data.inputs),
    prompt: exec && typeof exec.prompt === "string" ? exec.prompt : undefined,
    executor: exec && typeof exec.type === "string" ? exec.type : undefined,
    outputs: outputPaths(data.outputs),
  };
}

function flowgitBlock(lines: string[]): string | undefined {
  let fence: { mark: string; len: number } | undefined;
  let capture = false;
  const buf: string[] = [];
  for (const line of lines) {
    if (!fence) {
      const opened = openFence(line);
      if (opened) {
        fence = opened;
        const lang = fenceLang(line);
        capture = lang === "flowgit";
        buf.length = 0;
      }
      continue;
    }
    if (closesFence(line, fence)) {
      if (capture) return buf.join("\n");
      fence = undefined;
      capture = false;
      continue;
    }
    if (capture) buf.push(line);
  }
  return undefined;
}

function openFence(line: string): { mark: string; len: number } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) return undefined;
  return { mark: match[1]![0]!, len: match[1]!.length };
}

function fenceLang(line: string): string {
  const match = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(line);
  return match?.[1] ?? "";
}

function closesFence(line: string, fence: { mark: string; len: number }): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith(fence.mark)) return false;
  const marks = trimmed.replace(/[^`~]/g, "");
  return marks.length >= fence.len && trimmed.length === marks.length;
}

function headingOf(line: string): { level: 1 | 2; text: string; id?: string } | undefined {
  let level: 1 | 2 | undefined;
  let rest = "";
  if (line.startsWith("## ") || line.startsWith("##\t")) {
    level = 2;
    rest = line.slice(3).trim();
  } else if ((line.startsWith("# ") || line.startsWith("#\t")) && !line.startsWith("##")) {
    level = 1;
    rest = line.slice(2).trim();
  }
  if (!level) return undefined;
  rest = rest.replace(/\s+#+$/, "").trim();
  const anchor = /^(.*)\s\{#([^}\s]+)\}\s*$/.exec(rest);
  if (!anchor) return { level, text: rest };
  return { level, text: anchor[1]!.trim(), id: anchor[2] };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function outputPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const item of value) {
    if (isRecord(item) && typeof item.path === "string") paths.push(item.path);
  }
  return paths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export interface OpenCandidate {
  relative: string;
  kind: "output" | "prompt" | "flow";
}

/** First output, then the prompt file, then the flow file. Existence is checked by the caller. */
export function openCandidates(stage: { outputs: string[]; prompt?: string }, flowFileName: string): OpenCandidate[] {
  const out: OpenCandidate[] = [];
  const first = stage.outputs[0];
  if (first) {
    const relative = first.replace(/\/+$/, "");
    if (relative) out.push({ relative, kind: "output" });
  }
  if (stage.prompt) out.push({ relative: stage.prompt, kind: "prompt" });
  out.push({ relative: flowFileName, kind: "flow" });
  return out;
}
