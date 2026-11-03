/**
 * YAML subset for flow.md fences: mappings, sequences, flow collections, scalars.
 * Enough for the flow.md format. Not a general YAML parser.
 */

interface YLine {
  indent: number;
  text: string;
}

export function parseYamlSubset(text: string): unknown {
  const lines = meaningful(text.replace(/^\uFEFF/, "").split(/\r?\n/));
  if (!lines.length) return {};
  return parseBlock(lines, 0).value;
}

function meaningful(raw: string[]): YLine[] {
  const out: YLine[] = [];
  for (const line of raw) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const text = stripInlineComment(line.slice(indent));
    if (!text) continue;
    out.push({ indent, text });
  }
  return out;
}

function stripInlineComment(text: string): string {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') {
        i++;
        continue;
      }
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && (i === 0 || text[i - 1] === " ")) return text.slice(0, i).trim();
  }
  return text.trim();
}

function parseBlock(lines: YLine[], index: number): { value: unknown; index: number } {
  if (index >= lines.length) return { value: {}, index };
  const line = lines[index]!;
  if (line.text === "-" || line.text.startsWith("- ")) return parseSeq(lines, index, line.indent);
  return parseMap(lines, index, line.indent);
}

function parseMap(lines: YLine[], index: number, indent: number): { value: Record<string, unknown>; index: number } {
  const map: Record<string, unknown> = {};
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index++;
      continue;
    }
    if (line.text === "-" || line.text.startsWith("- ")) break;
    const colon = indexOfColon(line.text);
    if (colon < 0) break;
    const key = unquoteKey(line.text.slice(0, colon).trim());
    const rest = line.text.slice(colon + 1).trim();
    index++;
    if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      const block = takeBlock(lines, index, indent);
      const joined = block.lines.join(rest.startsWith("|") ? "\n" : " ");
      map[key] = joined;
      index = block.index;
      continue;
    }
    if (rest === "") {
      if (index < lines.length && lines[index]!.indent > indent) {
        const nested = parseBlock(lines, index);
        map[key] = nested.value;
        index = nested.index;
      } else {
        map[key] = null;
      }
      continue;
    }
    if (rest.startsWith("{") || rest.startsWith("[")) {
      map[key] = parseFlow(rest);
      continue;
    }
    map[key] = parseScalar(rest);
  }
  return { value: map, index };
}

function parseSeq(lines: YLine[], index: number, indent: number): { value: unknown[]; index: number } {
  const arr: unknown[] = [];
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent < indent) break;
    if (line.indent > indent) break;
    if (line.text !== "-" && !line.text.startsWith("- ")) break;
    const rest = line.text === "-" ? "" : line.text.slice(1).trim();
    index++;
    if (rest === "") {
      if (index < lines.length && lines[index]!.indent > indent) {
        const nested = parseBlock(lines, index);
        arr.push(nested.value);
        index = nested.index;
      } else {
        arr.push(null);
      }
      continue;
    }
    if (rest.startsWith("{") || rest.startsWith("[")) {
      arr.push(parseFlow(rest));
      continue;
    }
    const colon = indexOfColon(rest);
    if (colon > 0 && !rest.startsWith('"') && !rest.startsWith("'")) {
      const key = unquoteKey(rest.slice(0, colon).trim());
      const valueText = rest.slice(colon + 1).trim();
      const item: Record<string, unknown> = {};
      if (valueText === "" && index < lines.length && lines[index]!.indent > indent) {
        const nested = parseBlock(lines, index);
        item[key] = nested.value;
        index = nested.index;
      } else if (valueText.startsWith("{") || valueText.startsWith("[")) {
        item[key] = parseFlow(valueText);
      } else {
        item[key] = valueText === "" ? null : parseScalar(valueText);
      }
      while (index < lines.length && lines[index]!.indent > indent && !lines[index]!.text.startsWith("- ")) {
        const more = parseMap(lines, index, lines[index]!.indent);
        Object.assign(item, more.value);
        index = more.index;
      }
      arr.push(item);
      continue;
    }
    arr.push(parseScalar(rest));
  }
  return { value: arr, index };
}

function takeBlock(lines: YLine[], index: number, parentIndent: number): { lines: string[]; index: number } {
  const collected: string[] = [];
  while (index < lines.length && lines[index]!.indent > parentIndent) {
    collected.push(lines[index]!.text);
    index++;
  }
  return { lines: collected, index };
}

function indexOfColon(text: string): number {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') {
        i++;
        continue;
      }
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ":") return i;
  }
  return -1;
}

function unquoteKey(text: string): string {
  return parseScalar(text) as string;
}

function parseScalar(text: string): unknown {
  if (text === "" || text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (text === "true" || text === "True" || text === "TRUE") return true;
  if (text === "false" || text === "False" || text === "FALSE") return false;
  if ((text.startsWith('"') && text.endsWith('"') && text.length >= 2) || (text.startsWith("'") && text.endsWith("'") && text.length >= 2)) {
    return unquote(text);
  }
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  return text;
}

function unquote(text: string): string {
  const quote = text[0]!;
  const body = text.slice(1, -1);
  if (quote === "'") return body.replace(/''/g, "'");
  return body.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseFlow(text: string): unknown {
  let i = 0;
  const value = parseFlowValue();
  return value;

  function skip() {
    while (text[i] === " " || text[i] === "\t") i++;
  }

  function parseFlowValue(): unknown {
    skip();
    if (text[i] === "[") return parseArr();
    if (text[i] === "{") return parseObj();
    if (text[i] === '"' || text[i] === "'") return parseQuoted();
    const start = i;
    let depth = 0;
    while (i < text.length) {
      const c = text[i]!;
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) break;
      i++;
    }
    return parseScalar(text.slice(start, i).trim());
  }

  function parseQuoted(): string {
    const quote = text[i]!;
    i++;
    let out = "";
    while (i < text.length) {
      const c = text[i]!;
      if (quote === "'" && c === "'" && text[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      if (quote === '"' && c === "\\") {
        const n = text[i + 1];
        if (n === "n") out += "\n";
        else if (n === "t") out += "\t";
        else if (n === '"') out += '"';
        else if (n === "\\") out += "\\";
        else out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) {
        i++;
        break;
      }
      out += c;
      i++;
    }
    return out;
  }

  function parseArr(): unknown[] {
    i++;
    const arr: unknown[] = [];
    skip();
    if (text[i] === "]") {
      i++;
      return arr;
    }
    while (i < text.length) {
      arr.push(parseFlowValue());
      skip();
      if (text[i] === ",") {
        i++;
        skip();
        if (text[i] === "]") {
          i++;
          break;
        }
        continue;
      }
      if (text[i] === "]") i++;
      break;
    }
    return arr;
  }

  function parseObj(): Record<string, unknown> {
    i++;
    const obj: Record<string, unknown> = {};
    skip();
    if (text[i] === "}") {
      i++;
      return obj;
    }
    while (i < text.length) {
      skip();
      let key: string;
      if (text[i] === '"' || text[i] === "'") key = parseQuoted();
      else {
        const start = i;
        while (i < text.length && text[i] !== ":" && text[i] !== "}") i++;
        key = text.slice(start, i).trim();
      }
      skip();
      if (text[i] === ":") i++;
      obj[key] = parseFlowValue();
      skip();
      if (text[i] === ",") {
        i++;
        skip();
        if (text[i] === "}") {
          i++;
          break;
        }
        continue;
      }
      if (text[i] === "}") i++;
      break;
    }
    return obj;
  }
}
