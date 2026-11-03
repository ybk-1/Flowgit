import fs from "node:fs";
import path from "node:path";

/** Byte-for-byte copy. The build uses the same source and destination names. */
export function copySchemaFile(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

export function filesEqual(a: string, b: string): boolean {
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

export function coreSchemaPath(repoRoot: string): string {
  return path.join(repoRoot, "packages", "core", "schema", "flow.schema.json");
}
