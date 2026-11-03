export interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  /** True when the template has demo-replies/ (free canned model answers). */
  demo: boolean;
  /** How many stages the flow has. */
  stages: number;
}

export async function templateIndex(): Promise<TemplateEntry[]> {
  const res = await fetch("./templates/index.json");
  if (!res.ok) throw new Error(`模板列表读取失败 / could not load the template list (${res.status})`);
  return (await res.json()) as TemplateEntry[];
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Every file of a bundled template, by path relative to the flow directory. */
export async function templateFiles(id: string): Promise<Record<string, Uint8Array>> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`没有这个模板 / unknown template: ${id}`);
  const res = await fetch(`./templates/${id}.json`);
  if (!res.ok) throw new Error(`没有这个模板 / unknown template: ${id}`);
  const data = (await res.json()) as { files: Record<string, string> };
  return Object.fromEntries(Object.entries(data.files).map(([rel, b64]) => [rel, fromBase64(b64)]));
}
