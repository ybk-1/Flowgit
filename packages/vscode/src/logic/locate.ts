import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root from a test file that lives in packages/vscode/src/logic. */
export function repoRoot(importMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "../../../..");
}
