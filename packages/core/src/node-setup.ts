// What the Node entry adds to the shared core: the Node host, the MCP executor (it starts
// local server processes), and Node's proxy support. Imported first by index.ts, and by the
// vitest setup so tests that import modules directly get the same.
import { setHost } from "./host/current.js";
import { nodeHost } from "./host/node.js";
import { registerExecutor } from "./executors/index.js";
import { mcpExecutor } from "./executors/mcp.js";
import "./proxy.js";

setHost(nodeHost);
registerExecutor("mcp", mcpExecutor);
