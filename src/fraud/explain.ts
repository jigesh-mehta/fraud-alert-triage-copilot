import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { HistoryTxn } from "./rules";
import type { Decision, RuleHit, Transaction } from "./types";

export const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Used when the LLM call fails, so a decision is never lost. */
export function fallbackExplanation(decision: Decision, hits: RuleHit[]) {
  if (hits.length === 0) return `Decision: ${decision}. No risk rules fired.`;
  return `Decision: ${decision}. Rules fired: ${hits.map((h) => h.message).join("; ")}.`;
}

function summarizeHistory(history: HistoryTxn[]): string {
  if (history.length === 0) return "No transactions in the last 24 hours.";
  const approved = history.filter((h) => h.decision === "APPROVE");
  const total = approved.reduce((s, h) => s + h.amount, 0);
  const countries = [...new Set(history.map((h) => h.countryCode))].sort();
  const avg =
    approved.length > 0
      ? `average approved amount ${(total / approved.length).toFixed(2)} over ${approved.length} approved`
      : "no approved transactions";
  return `${history.length} transactions in the last 24 hours (${history.length - approved.length} flagged), ${avg}, countries: ${countries.join(", ")}.`;
}

/**
 * Asks Llama 3.3 to write a human-readable risk explanation. The decision and
 * rule hits come from the deterministic rules engine; the model only explains.
 */
export async function explainRisk(
  env: Env,
  txn: Transaction,
  hits: RuleHit[],
  decision: Decision,
  score: number,
  history: HistoryTxn[]
): Promise<string> {
  const workersai = createWorkersAI({ binding: env.AI });
  const { text } = await generateText({
    model: workersai(LLM_MODEL),
    system: `You explain fraud-rule results to a fraud analyst. The decision and rule hits were computed by a deterministic rules engine. Do not change the decision, do not invent rules or facts, and do not recommend a different decision. Write 2-4 plain sentences: the outcome, the specific reasons (cite the numbers), and one suggested next check for the analyst.`,
    prompt: JSON.stringify(
      {
        decision,
        score,
        transaction: {
          accountId: txn.accountId,
          amount: txn.amount,
          currency: txn.currency,
          countryCode: txn.countryCode,
          merchant: txn.merchant,
          channel: txn.channel,
          time: new Date(txn.timestamp).toISOString()
        },
        ruleHits: hits.map((h) => ({ rule: h.rule, message: h.message })),
        accountHistory: summarizeHistory(history)
      },
      null,
      2
    )
  });
  const explanation = text.trim();
  if (!explanation) throw new Error("Empty explanation from model");
  return explanation;
}
