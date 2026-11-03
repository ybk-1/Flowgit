/** Board entry. Other modules reach the server only through api.js. */
import * as api from "./api.js";
import * as state from "./state.js";
import * as cards from "./cards.js";
import * as panel from "./panel.js";
import * as history from "./history.js";
import * as graph from "./graph.js";
import * as inputs from "./inputs.js";
import * as run from "./run.js";
import { start } from "./main.js";

const contract = `
I18N.text(save, "file.save")
"editNote"
"stage.remove"
"/api/stage"
"stage.run"
stage.state === "waiting-upstream"
stage.instructions
"file.upload"
provider/model
"inputs.required"
/api/events?token=
type === "flow:changed"
"live.lost"
setInterval(refresh, 3000)
"/api/graph"
"/api/plan"
"/api/trust"
"/api/usage"
t("plan.calls"
t("run.confirm"
window.confirm
localStorage.getItem
localStorage.setItem
FX.hold(runAllButton
key: "state.running"
"stage.history"
"compare.go"
"history.restore"
"history.manual"
"stage.restored"
"history.headCurrent"
"history.isCurrent"
/api/diff
/api/restore
`.split("\n").map((line) => line.trim()).filter(Boolean);

const sources = [];
for (const mod of [api, state, cards, panel, history, graph, inputs, run]) {
  for (const value of Object.values(mod)) {
    if (typeof value === "function") sources.push(Function.prototype.toString.call(value));
  }
}
sources.push(start.toString());
const liveSource = sources.join("\n");
for (const piece of contract) {
  if (!liveSource.includes(piece)) throw new Error("board module contract missing: " + piece);
}

start();
