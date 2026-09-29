import { describe, expect, it } from "vitest";
import { endTurnAfterCard } from "./stop";

const step = (...r: { toolName: string; output: unknown }[]) => ({
  toolResults: r
});
const ok = { status: "ok" };

describe("endTurnAfterCard", () => {
  it("ends after a successful card tool", () => {
    expect(
      endTurnAfterCard({
        steps: [step({ toolName: "getAccountHistory", output: ok })]
      })
    ).toBe(true);
    expect(
      endTurnAfterCard({
        steps: [step({ toolName: "triageTransaction", output: ok })]
      })
    ).toBe(true);
  });

  it("continues after explainCase so the model can explain briefly", () => {
    expect(
      endTurnAfterCard({
        steps: [step({ toolName: "explainCase", output: ok })]
      })
    ).toBe(false);
  });

  it("continues after non-ok statuses", () => {
    for (const status of ["missing_fields", "error", "pending"]) {
      expect(
        endTurnAfterCard({
          steps: [step({ toolName: "getAccountHistory", output: { status } })]
        })
      ).toBe(false);
    }
  });

  it("continues when there were no tool calls", () => {
    expect(endTurnAfterCard({ steps: [step()] })).toBe(false);
    expect(endTurnAfterCard({ steps: [] })).toBe(false);
  });
});
