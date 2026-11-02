import { Document, isScalar, isSeq, parseDocument, visit } from "yaml";
import type { Flow } from "./types.js";

/**
 * flow.md: the same flow as flow.json, written as Markdown.
 *
 *   ---                      YAML frontmatter = flow-level fields
 *   format: flowgit
 *   version: "0.1"
 *   ---
 *   # Flow name              H1 = flow.name
 *   Prose …                  = flow.description
 *   ## Stage name {#id}      one H2 per stage: name and id
 *   Prose …                  = stage.description
 *   ```flowgit               YAML = every other stage field
 *   executor: { type: llm, prompt: prompts/x.md }
 *   outputs: [{ type: text/markdown, path: x.md }]
 *   ```
 *
 * Any field may also be written in the YAML; the heading and prose are
 * shorthand, and giving a field both ways is an error. parseFlowMd returns the
 * plain object that flow.json would hold, so the same JSON Schema validates it.
 */

export class FlowMdError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(line ? `第 ${line} 行 / line ${line}: ${message}` : message);
    this.name = "FlowMdError";
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/;
const H1 = /^#\s+(.*?)\s*#*\s*$/;
const H2 = /^##\s+(.*?)\s*$/;
const ANCHOR = /\s*\{#([^}\s]*)\}$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseYaml(text: string, line: number, what: string): Obj {
  const doc = parseDocument(text, { version: "1.2", uniqueKeys: true });
  if (doc.errors.length) {
    const e = doc.errors[0]!;
    const at = e.linePos?.[0]?.line;
    throw new FlowMdError(`${what} 的 YAML 写错了 / invalid YAML in ${what}: ${e.message.split("\n")[0]}`, at ? line + at - 1 : line);
  }
  const value = doc.toJS() as unknown;
  if (value === null || value === undefined) return {};
  if (!isObj(value)) throw new FlowMdError(`${what} 要写成 "字段: 值" 的形式 / ${what} must be a YAML mapping`, line);
  return value;
}

/** Joins prose lines and trims blank lines at both ends; undefined when empty. */
function prose(lines: string[]): string | undefined {
  const text = lines.join("\n").replace(/^\s*\n/, "").trim();
  return text ? text : undefined;
}

function both(field: string, where: string, line: number): FlowMdError {
  return new FlowMdError(
    `${where} 的 ${field} 写了两次（标题/正文里一次，YAML 里一次），只留一个 / ${where} gives "${field}" twice (heading or prose, and YAML); keep one`,
    line,
  );
}

interface Section {
  heading: string;
  line: number;
  body: { text: string; line: number }[];
}

/** Parse flow.md text into the object flow.json would hold. Throws FlowMdError. */
export function parseFlowMd(source: string): Obj {
  const lines = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new FlowMdError(`flow.md 要以 --- 开头的 YAML 头开始 / flow.md must start with YAML frontmatter between --- lines`, 1);
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) throw new FlowMdError(`YAML 头缺少结尾的 --- / frontmatter has no closing ---`, 1);
  const flow: Obj = parseYaml(lines.slice(1, end).join("\n"), 2, "YAML 头 / frontmatter");
  if ("stages" in flow) {
    throw new FlowMdError(`阶段要写成 "## 名字 {#id}" 小节，不能写在 YAML 头里 / write stages as "## Name {#id}" sections, not in the frontmatter`, 1);
  }

  // Split the body into the flow intro and one section per H2, skipping fenced code.
  let title: { text: string; line: number } | undefined;
  const intro: string[] = [];
  const sections: Section[] = [];
  let fence: string | undefined;
  for (let i = end + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    const n = i + 1;
    const current = sections[sections.length - 1];
    if (!fence) {
      const h2 = H2.exec(raw);
      if (h2) {
        sections.push({ heading: h2[1]!, line: n, body: [] });
        continue;
      }
      const h1 = H1.exec(raw);
      if (h1 && !current && !title && !intro.some((l) => l.trim())) {
        title = { text: h1[1]!, line: n };
        continue;
      }
      if (h1) throw new FlowMdError(`只能有一个 "# 流程名" 标题，而且要在第一个阶段前面 / only one "# Flow name" heading, before the first stage`, n);
    }
    const f = FENCE.exec(raw);
    if (f) {
      if (!fence) fence = f[1];
      else if (raw.trim().startsWith(fence[0]!) && raw.trim().replace(/[`~]/g, "") === "" && raw.trim().length >= fence.length) fence = undefined;
    }
    if (current) current.body.push({ text: raw, line: n });
    else intro.push(raw);
  }
  if (fence) throw new FlowMdError(`代码块没有结束 / a fenced code block is never closed`);

  if (title) {
    if ("name" in flow) throw both("name", "流程 / the flow", title.line);
    flow.name = title.text;
  }
  const description = prose(intro);
  if (description !== undefined) {
    if ("description" in flow) throw both("description", "流程 / the flow", end + 2);
    flow.description = description;
  }

  flow.stages = sections.map((s) => parseStage(s));
  return flow;
}

function parseStage(s: Section): Obj {
  let heading = s.heading;
  let id: string | undefined;
  const a = ANCHOR.exec(heading);
  if (a) {
    id = a[1];
    heading = heading.slice(0, a.index).trim();
  }
  const where = `阶段 "${heading || id || s.line}" / stage "${heading || id || s.line}"`;

  let stage: Obj | undefined;
  const rest: string[] = [];
  for (let i = 0; i < s.body.length; i++) {
    const { text, line } = s.body[i]!;
    const f = FENCE.exec(text);
    if (!f) {
      rest.push(text);
      continue;
    }
    // Find this fence's closing line.
    const marker = f[1]!;
    let j = i + 1;
    while (j < s.body.length) {
      const t = s.body[j]!.text.trim();
      if (t.startsWith(marker[0]!) && t.replace(/[`~]/g, "") === "" && t.length >= marker.length) break;
      j++;
    }
    const block = s.body.slice(i, j + 1).map((b) => b.text);
    if (f[2] === "flowgit") {
      if (stage) throw new FlowMdError(`${where} 有两个 flowgit 代码块，只能有一个 / ${where} has two flowgit blocks; keep one`, line);
      stage = parseYaml(block.slice(1, -1).join("\n"), line + 1, where);
    } else {
      rest.push(...block);
    }
    i = j;
  }
  if (!stage) {
    throw new FlowMdError(`${where} 缺少 \`\`\`flowgit 代码块（写 executor 和 outputs）/ ${where} needs a \`\`\`flowgit block (with executor and outputs)`, s.line);
  }

  const out: Obj = {};
  if (id !== undefined) {
    if ("id" in stage) throw both("id", where, s.line);
    out.id = id;
  }
  if (heading) {
    if ("name" in stage) throw both("name", where, s.line);
    out.name = heading;
  }
  const description = prose(rest);
  if (description !== undefined) {
    if ("description" in stage) throw both("description", where, s.line);
    out.description = description;
  }
  return { ...out, ...stage };
}

// ---------------------------------------------------------------------------
// Rendering

/** YAML with short lists on one line: `tags: [a, b]`, `- { type: x, path: y }`. */
function yaml(value: unknown): string {
  const doc = new Document(value, { version: "1.2" });
  visit(doc, {
    Seq(_key, node) {
      if (node.items.length && node.items.every((i) => isScalar(i))) node.flow = true;
    },
    Map(_key, node, path) {
      const parent = path[path.length - 1];
      if (isSeq(parent) && node.items.every((p) => isScalar(p.value))) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
}

/** Text that reads back unchanged as a heading. */
function headingSafe(text: string): boolean {
  return text.length > 0 && text === text.trim() && !/[\n\r]/.test(text) && !ANCHOR.test(text) && !/#$/.test(text);
}

/** Text that reads back unchanged as prose (no headings, no fences, no frontmatter markers). */
function proseSafe(text: string): boolean {
  if (!text || text !== text.trim() || /\r/.test(text)) return false;
  return text.split("\n").every((l) => !/^#{1,2}(\s|$)/.test(l) && !FENCE.test(l));
}

/** Render a flow as flow.md. parseFlowMd(renderFlowMd(f)) deep-equals f. */
export function renderFlowMd(flow: Flow): string {
  const { stages, name, description, ...head } = flow as unknown as Obj & { stages: Obj[] };
  const front: Obj = { ...head };
  const titleOk = typeof name === "string" && headingSafe(name);
  if (!titleOk && name !== undefined) front.name = name;
  const descOk = typeof description === "string" && proseSafe(description);
  if (!descOk && description !== undefined) front.description = description;

  const parts: string[] = ["---", yaml(front), "---", ""];
  if (titleOk) parts.push(`# ${name as string}`, "");
  if (descOk) parts.push(description as string, "");

  for (const stage of stages ?? []) {
    const { id, name: sName, description: sDesc, ...rest } = stage;
    const block: Obj = {};
    const idOk = typeof id === "string" && /^[^}\s]+$/.test(id);
    if (!idOk && id !== undefined) block.id = id;
    const nameOk = typeof sName === "string" && headingSafe(sName);
    if (!nameOk && sName !== undefined) block.name = sName;
    const sDescOk = typeof sDesc === "string" && proseSafe(sDesc);
    if (!sDescOk && sDesc !== undefined) block.description = sDesc;
    Object.assign(block, rest);
    const heading = [nameOk ? (sName as string) : "", idOk ? `{#${id as string}}` : ""].filter(Boolean).join(" ");
    if (!heading) throw new Error(`阶段没有 id 也没有名字，没法写成 flow.md / a stage with no id and no name cannot be written as flow.md`);
    parts.push(`## ${heading}`, "");
    if (sDescOk) parts.push(sDesc as string, "");
    parts.push("```flowgit", yaml(block), "```", "");
  }
  return `${parts.join("\n").trimEnd()}\n`;
}
