import { parse } from "yaml";
import { type ImportFormat, type ImportResult, ImportFormatError, NOT_DIFY, NOT_N8N, UNKNOWN_IMPORT_FORMAT } from "./common.js";
import { importDify, isDifyDocument } from "./dify.js";
import { importN8n, isN8nDocument } from "./n8n.js";

export {
  ImportFormatError,
  NOT_DIFY,
  NOT_N8N,
  UNKNOWN_IMPORT_FORMAT,
  fileNameOnly,
  importSource,
  presetModel,
  upstreamNote,
  type ImportFormat,
  type ImportReportEntry,
  type ImportResult,
} from "./common.js";

function parsedValues(text: string): unknown[] {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return [];
  const values: unknown[] = [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      values.push(JSON.parse(trimmed));
    } catch {
      // YAML may still describe a Dify app.
    }
  }
  try {
    values.push(parse(trimmed));
  } catch {
    // Not YAML. JSON above may already have matched.
  }
  return values;
}

/** dify when the text has `app` and `workflow.graph`; n8n when it has `nodes` and `connections`. */
export function detectImportFormat(text: string): ImportFormat | undefined {
  let dify = false;
  let n8n = false;
  for (const value of parsedValues(text)) {
    if (isDifyDocument(value)) dify = true;
    if (isN8nDocument(value)) n8n = true;
  }
  if (dify === n8n) return undefined;
  return dify ? "dify" : "n8n";
}

/** Convert a Dify DSL or an n8n workflow. `format` forces one; otherwise the text is detected. */
export function importWorkflow(text: string, options: { filename: string; format?: ImportFormat }): ImportResult {
  const detected = detectImportFormat(text);
  if (options.format === "dify") {
    if (detected === "n8n") throw new ImportFormatError(NOT_DIFY);
    return importDify(text, options.filename);
  }
  if (options.format === "n8n") {
    if (detected === "dify") throw new ImportFormatError(NOT_N8N);
    return importN8n(text, options.filename);
  }
  if (!detected) throw new ImportFormatError(UNKNOWN_IMPORT_FORMAT);
  return detected === "dify" ? importDify(text, options.filename) : importN8n(text, options.filename);
}
