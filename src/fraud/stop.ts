/** Tools whose successful result is rendered as a card; the turn ends there. */
const CARD_TOOLS = new Set(["triageTransaction", "getAccountHistory"]);

interface ToolResultLike {
  toolName: string;
  output: unknown;
}

/**
 * True when every tool result in the last step succeeded and came from a
 * card-rendering tool, so no prose reply is needed. Tools like explainCase
 * are not card tools: their result feeds a short model explanation.
 */
export function endTurnAfterCard({
  steps
}: {
  steps: { toolResults: ToolResultLike[] }[];
}): boolean {
  const results = steps.at(-1)?.toolResults ?? [];
  return (
    results.length > 0 &&
    results.every(
      (r) =>
        CARD_TOOLS.has(r.toolName) &&
        (r.output as { status?: string } | null)?.status === "ok"
    )
  );
}
