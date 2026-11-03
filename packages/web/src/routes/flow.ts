import { isDirOutput, isTextType, loadFlow, outputRel, resolveFlowInputs, statusAll } from "@flowgit/core";

export interface BoardOutput {
  path: string;
  type: string;
  directory: boolean;
  /** File output that `isTextType` treats as text, so the board can edit it. */
  text: boolean;
}

export interface BoardStage {
  id: string;
  name: string;
  executor: string;
  state: string;
  runs: number;
  latest: { n: number; time: string; status: string } | null;
  /** The run the files on disk match, when known (StageStatus.current); after a restore it differs from latest. */
  current: number | null;
  /** Human stage instructions, when the executor has them. */
  instructions?: string;
  outputs: BoardOutput[];
}

/** One flow input as GET /api/inputs returns it. `value` is resolveFlowInputs. */
export interface BoardInputField {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  enum?: unknown[];
  default?: unknown;
  /** null when the input has no value yet. */
  value: unknown;
}

/** JSON body of GET /api/flow. `inputs` is exactly resolveFlowInputs. */
export interface FlowBoard {
  name: string;
  inputs: Record<string, unknown>;
  missingInputs: string[];
  stages: BoardStage[];
}

export function flowBoard(dir: string): FlowBoard {
  const loaded = loadFlow(dir);
  const inputs = resolveFlowInputs(loaded.dir, loaded.flow);
  const missingInputs = Object.entries(loaded.flow.inputs ?? {})
    .filter(([key, def]) => def.required && (inputs[key] === undefined || inputs[key] === ""))
    .map(([key]) => key);
  return {
    name: loaded.flow.name,
    inputs,
    missingInputs,
    stages: statusAll(loaded, inputs).map((status) => ({
      id: status.stage.id,
      name: status.stage.name,
      executor: status.stage.executor.type,
      state: status.state,
      runs: status.runs,
      latest: status.latest
        ? { n: status.latest.n, time: status.latest.finishedAt, status: status.latest.status }
        : null,
      current: status.current ?? null,
      ...(status.stage.executor.type === "human" && status.stage.executor.instructions
        ? { instructions: status.stage.executor.instructions }
        : {}),
      outputs: status.stage.outputs.map((output) => {
        const directory = isDirOutput(output);
        return {
          path: outputRel(output),
          type: output.type,
          directory,
          text: !directory && isTextType(output.type, output.path),
        };
      }),
    })),
  };
}
