import { host, path } from "../host/current.js";
import {
  DEFAULT_IMAGE_SIZE,
  DEFAULT_IMAGE_TIMEOUT_SEC,
  generateImage,
  resolveImageModel,
  type ImagePreset,
} from "../image-providers.js";
import type { ExecutorImage, ImageEach } from "../types.js";
import { linkOutsideError, outputRel, readFlowText, staysInside } from "../util.js";
import { renderTemplate } from "./llm.js";
import type { ExecContext, ExecResult, StageExecutor } from "./types.js";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function fileName(index: number): string {
  return `${String(index + 1).padStart(3, "0")}.png`;
}

function imagePrompt(template: string, extra?: string): string {
  const base = template.trim();
  const line = extra?.trim() ?? "";
  if (!line) {
    if (!base) throw new Error(`提示词是空的 / the prompt is empty`);
    return base;
  }
  return base ? `${base}\n\n${line}` : line;
}

function readJson(dir: string, rel: string): unknown {
  const abs = path.join(dir, rel);
  if (!staysInside(dir, abs)) throw linkOutsideError(rel);
  let text: string;
  try {
    text = host().readFile(abs, "utf8");
  } catch {
    throw new Error(`找不到 ${rel} / ${rel} was not found`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${rel} 不是合法的 JSON / ${rel} is not valid JSON`);
  }
}

function valueAt(data: unknown, dotted: string): unknown {
  let current = data;
  for (const part of dotted.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function promptsFor(dir: string, rendered: string, each: ImageEach | undefined, n: number | undefined): string[] {
  if (!each) {
    const prompt = imagePrompt(rendered);
    return Array.from({ length: n ?? 1 }, () => prompt);
  }
  const data = readJson(dir, each.from);
  const items = valueAt(data, each.path);
  if (!Array.isArray(items)) {
    throw new Error(`${each.from} 里的 ${each.path} 不是数组 / ${each.path} in ${each.from} is not an array`);
  }
  if (!items.length) throw new Error(`${each.path} 是空的，没有要生成的图片 / ${each.path} is empty, so there is nothing to generate`);
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 项不是对象，读不到 ${each.field} / item ${index + 1} is not an object, so ${each.field} cannot be read`);
    }
    const value = (item as Record<string, unknown>)[each.field];
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`第 ${index + 1} 项没有 ${each.field} / item ${index + 1} has no ${each.field}`);
    }
    return imagePrompt(rendered, value);
  });
}

/** Pictures in `<mockDir>/<stageId>/`, sorted by name. Too few and they repeat from the start. */
export function mockPictures(mockDir: string, stageId: string, count: number): Uint8Array[] {
  const dir = path.join(path.resolve(mockDir), stageId);
  if (!host().exists(dir) || !host().stat(dir).isDirectory()) {
    throw new Error(
      `FLOWGIT_IMAGE_MOCK_DIR 里没有阶段 "${stageId}" 的图片 / FLOWGIT_IMAGE_MOCK_DIR has no pictures for stage "${stageId}" (expected a directory ${dir})`,
    );
  }
  const files = host()
    .readdir(dir)
    .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  if (!files.length) {
    throw new Error(`FLOWGIT_IMAGE_MOCK_DIR 里阶段 "${stageId}" 没有图片文件 / FLOWGIT_IMAGE_MOCK_DIR has no picture files for stage "${stageId}" in ${dir}`);
  }
  return Array.from({ length: count }, (_item, index) => host().readFile(path.join(dir, files[index % files.length]!)));
}

function writePictures(dir: string, rel: string, pictures: Uint8Array[]): { file: string; bytes: number }[] {
  const abs = path.join(dir, rel);
  if (host().exists(abs) && !staysInside(dir, abs)) throw linkOutsideError(rel);
  host().rm(abs, { recursive: true, force: true });
  host().mkdir(abs, { recursive: true });
  if (!staysInside(dir, abs)) throw linkOutsideError(rel);
  return pictures.map((bytes, index) => {
    const name = fileName(index);
    const file = path.join(abs, name);
    if (!staysInside(abs, file)) throw new Error(`图片文件名不合法 / invalid picture name ${name}`);
    host().writeFile(file, bytes);
    return { file: name, bytes: bytes.length };
  });
}

export const imageExecutor: StageExecutor = {
  async run(ctx: ExecContext): Promise<ExecResult> {
    const ex = ctx.stage.executor as ExecutorImage;
    if (ctx.stage.outputs.length !== 1 || !ctx.stage.outputs[0]!.path.endsWith("/")) {
      throw new Error(
        `image 阶段只能有一个以 / 结尾的目录产物 / an image stage needs exactly one directory output whose path ends with / ("${ctx.stage.id}")`,
      );
    }
    const env = ctx.options.env ?? host().env;
    const rendered = renderTemplate(readFlowText(ctx.loaded.dir, ex.prompt), ctx.flowInputs);
    const prompts = promptsFor(ctx.loaded.dir, rendered, ex.each, ex.n);
    const size = ex.size ?? DEFAULT_IMAGE_SIZE;
    const timeoutSec = ex.timeoutSec ?? DEFAULT_IMAGE_TIMEOUT_SEC;
    const resolved = resolveImageModel(ex.model, env);
    const started = Date.now();
    let pictures: Uint8Array[];
    const mockDir = env.FLOWGIT_IMAGE_MOCK_DIR;
    if (mockDir) {
      ctx.log(`使用固定图片 / using canned pictures ${mockDir}`);
      pictures = mockPictures(mockDir, ctx.stage.id, prompts.length);
    } else {
      if (env.FLOWGIT_IMAGE_BASE_URL?.trim()) {
        ctx.log(`生图地址改用 FLOWGIT_IMAGE_BASE_URL / image endpoint taken from FLOWGIT_IMAGE_BASE_URL`);
      }
      pictures = [];
      for (const prompt of prompts) {
        ctx.log(`生成 ${pictures.length + 1}/${prompts.length} / generating ${pictures.length + 1}/${prompts.length} (${resolved.preset.id}/${resolved.model})`);
        pictures.push(await generateImage({ preset: resolved.preset, model: resolved.model, prompt, size, baseUrl: resolved.baseUrl, timeoutSec, env }));
      }
    }
    const rel = outputRel(ctx.stage.outputs[0]!);
    const images = writePictures(ctx.loaded.dir, rel, pictures);
    ctx.log(`已写入 / wrote ${images.length} 张到 / picture(s) to ${rel}/`);
    return {
      params: imageParams(resolved.preset, resolved.model, size, images, Date.now() - started),
    };
  },
};

function imageParams(preset: ImagePreset, model: string, size: string, images: { file: string; bytes: number }[], durationMs: number) {
  return {
    provider: preset.id,
    model,
    size,
    count: images.length,
    images,
    durationMs,
  };
}
