import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env.js";
import { room, roomRequest } from "../flows.js";

/**
 * One cloud run = one Cloudflare Workflows instance
 * (https://developers.cloudflare.com/workflows/build/workers-api/), with the run's id.
 * Each step asks the flow's room to do the next stage (runs/next.ts) and reports where the run
 * stands. When a person has to upload something, or a stage needs a computer, the instance
 * waits for a "continue" event (step.waitForEvent, up to WAIT_TIMEOUT) without holding anything,
 * then asks again. A step's own retries cover the room restarting mid-stage; a stage's failure is
 * an answer, not an exception, so it is not retried here (the flow's `retries` already ran).
 */
export interface RunParams {
  flowId: string;
  runId: string;
  userId: string;
}

export type StepAnswer =
  | { state: "next" }
  | { state: "waiting"; kind: "human" | "computer"; stage: string }
  | { state: "done" | "failed" | "budget" | "cancelled" | "gone"; error?: string };

export const CONTINUE_EVENT = "continue";
export const WAIT_TIMEOUT = "30 days";
/** A flow has at most a few hundred stages; this only stops a run that goes round. */
export const MAX_STEPS = 1000;

export class FlowRun extends WorkflowEntrypoint<Env, RunParams> {
  async run(event: Readonly<WorkflowEvent<RunParams>>, step: WorkflowStep): Promise<StepAnswer> {
    const { flowId, runId, userId } = event.payload;
    const call = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
      const res = await room(this.env, flowId).fetch(
        roomRequest(flowId, userId, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, ...body }) }),
      );
      const answer = (await res.json()) as T & { error?: string };
      // 4xx: the room says no for good (the run was cancelled or the flow deleted).
      if (res.status >= 500) throw new Error(answer.error ?? `room ${res.status}`);
      if (!res.ok) return { state: "gone", error: answer.error } as T;
      return answer;
    };
    for (let i = 1; i <= MAX_STEPS; i++) {
      const answer = await step.do(
        `step ${i}`,
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "30 minutes" },
        () => call<StepAnswer>("/run/step", { step: i }),
      );
      if (answer.state === "next") continue;
      if (answer.state !== "waiting") return answer;
      let resumed: { cancel?: boolean } | undefined;
      try {
        const got = await step.waitForEvent<{ cancel?: boolean }>(`wait ${i}`, { type: CONTINUE_EVENT, timeout: WAIT_TIMEOUT });
        resumed = got.payload ?? {};
      } catch {
        // Nobody came back in time.
        return await step.do(`expire ${i}`, () => call<StepAnswer>("/run/finish", { state: "expired" }));
      }
      if (resumed.cancel) return await step.do(`cancel ${i}`, () => call<StepAnswer>("/run/finish", { state: "cancelled" }));
    }
    return await step.do("too many steps", () => call<StepAnswer>("/run/finish", { state: "failed", error: `超过 ${MAX_STEPS} 步 / more than ${MAX_STEPS} steps` }));
  }
}
