import { getNodeValue, parseTree, type Node, type ParseError } from "jsonc-parser";
import { positionAt } from "./lines.js";

export interface CodeLensAnchor {
  stageId: string;
  line: number;
  character: number;
}

/**
 * Where each stage object starts in a flow.json document.
 * Positions come from jsonc-parser's tree, not from a regular expression.
 */
export function stageCodeLensAnchors(text: string): CodeLensAnchor[] {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (!root || !isType(root, "object")) return [];
  const stages = propertyValue(root, "stages");
  if (!stages || !isType(stages, "array")) return [];
  const anchors: CodeLensAnchor[] = [];
  for (const node of stages.children ?? []) {
    if (!isType(node, "object")) continue;
    const idNode = propertyValue(node, "id");
    const id = nodeString(idNode);
    if (!id) continue;
    const pos = positionAt(text, node.offset);
    anchors.push({ stageId: id, line: pos.line, character: pos.character });
  }
  return anchors;
}

function propertyValue(objectNode: Node, key: string): Node | undefined {
  for (const prop of objectNode.children ?? []) {
    if (!isType(prop, "property") || !prop.children || prop.children.length < 2) continue;
    const name = nodeString(prop.children[0]);
    if (name === key) return prop.children[1];
  }
  return undefined;
}

function nodeString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (typeof node.value === "string") return node.value;
  const value = getNodeValue(node);
  return typeof value === "string" ? value : undefined;
}

function isType(node: Node, name: "object" | "array" | "property" | "string"): boolean {
  const kind = node.type as unknown;
  if (kind === name) return true;
  if (typeof kind === "number") {
    const label = ["object", "array", "property", "string", "number", "boolean", "null"][kind];
    return label === name;
  }
  return false;
}
