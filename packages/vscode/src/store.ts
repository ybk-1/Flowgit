import fs from "node:fs";
import { resolveCli, type CliSearch } from "./logic/cli.js";
import { loadFlowViews, type FlowView } from "./logic/model.js";
import { spawnCaptured, type CommandResult } from "./logic/spawn.js";
import { debounce, REFRESH_DEBOUNCE_MS } from "./logic/watch.js";

export interface FlowEnv {
  roots: string[];
  search: CliSearch;
}

export class FlowStore {
  views: FlowView[] = [];
  private generation = 0;
  private readonly debounced: { call: () => void; cancel: () => void };

  constructor(
    private readonly deps: {
      env: () => FlowEnv;
      run?: (command: string, args: string[], cwd: string) => Promise<CommandResult>;
      onChange: () => void;
    },
  ) {
    this.debounced = debounce(() => {
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  schedule(): void {
    this.debounced.call();
  }

  dispose(): void {
    this.debounced.cancel();
    this.generation++;
  }

  async refresh(): Promise<void> {
    const gen = ++this.generation;
    const env = this.deps.env();
    const cli = resolveCli(env.search, fs.existsSync);
    const run = this.deps.run ?? ((command, args, cwd) => spawnCaptured(command, args, cwd));
    const views = await loadFlowViews({ roots: env.roots, cli, run });
    if (gen !== this.generation) return;
    this.views = views;
    this.deps.onChange();
  }
}
