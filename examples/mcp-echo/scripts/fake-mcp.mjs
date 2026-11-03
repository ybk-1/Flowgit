/**
 * A tiny stdio MCP server for tests and examples/mcp-echo.
 * Newline-delimited JSON-RPC, no network. Tools: echo (text, json, lines, image, error, hang).
 */
import readline from "node:readline";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tinyWav() {
  const data = Buffer.alloc(44);
  data.write("RIFF", 0);
  data.writeUInt32LE(36, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(8000, 28);
  data.writeUInt16LE(1, 32);
  data.writeUInt16LE(8, 34);
  data.write("data", 36);
  data.writeUInt32LE(0, 40);
  return data.toString("base64");
}

const tools = [
  {
    name: "echo",
    description: "按 mode 回声：text、json、lines、image、error、hang / echo according to mode",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "要回声的文字 / text to echo" },
        mode: { type: "string", description: "text、json、lines、image、error 或 hang / text, json, lines, image, error or hang" },
        note: { type: "string", description: "上游正文 / upstream text" },
        path: { type: "string", description: "上游产物的相对路径 / relative path of an upstream output" },
      },
      required: ["text"],
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function resultFor(args) {
  const mode = args.mode ?? "text";
  if (mode === "error") {
    return { content: [{ type: "text", text: "tool failed: boom" }], isError: true };
  }
  if (mode === "json") {
    const structuredContent = { text: args.text ?? "", note: args.note ?? null, path: args.path ?? null };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }
  if (mode === "lines") {
    return { content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] };
  }
  if (mode === "image") {
    return {
      content: [
        { type: "text", text: "a pixel" },
        { type: "image", data: PNG, mimeType: "image/png" },
        { type: "audio", data: tinyWav(), mimeType: "audio/wav" },
      ],
    };
  }
  return { content: [{ type: "text", text: String(args.text ?? "") }] };
}

process.stderr.write(`stderr-ready\npid:${process.pid}\n`);

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!Object.hasOwn(msg, "id") || msg.id === null) return;
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-mcp", version: "0.0.1" },
      },
    });
    return;
  }
  if (msg.method === "ping") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    return;
  }
  if (msg.method === "tools/call") {
    const args = msg.params?.arguments ?? {};
    if ((args.mode ?? "text") === "hang") {
      setInterval(() => {}, 60_000);
      return;
    }
    send({ jsonrpc: "2.0", id: msg.id, result: resultFor(args) });
    return;
  }
  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
});
