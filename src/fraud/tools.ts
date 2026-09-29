import { getAgentByName } from "agents";
import { tool } from "ai";
import type { Transaction, TriageResult } from "./types";
import {
  accountHistoryInputSchema,
  explainCaseInputSchema,
  clampHistoryLimit,
  isGrounded,
  triageInputSchema,
  validateTriageInput
} from "./validation";

export type TriageOutcome =
  | ({ status: "ok" } & TriageResult)
  | { status: "pending"; workflowId: string; message: string };

export interface ToolContext {
  env: Env;
  runTriage: (txn: Transaction) => Promise<TriageOutcome>;
  /** Text of the analyst's latest message, used to verify mandatory fields. */
  getUserText: () => string;
}

export function buildTools({ env, runTriage, getUserText }: ToolContext) {
  return {
    triageTransaction: tool({
      description:
        "Evaluate one transaction against fraud rules and return the decision (APPROVE, REVIEW or DECLINE), rule hits and an explanation. Pass only values the user actually provided; leave a field out if the user did not state it. Never guess accountId, amount or countryCode.",
      inputSchema: triageInputSchema,
      execute: async (input) => {
        const v = validateTriageInput(input, Date.now(), getUserText());
        if (!v.ok) {
          return {
            status: "missing_fields" as const,
            missing: v.missing,
            invalid: v.invalid,
            message:
              "Transaction not processed. Ask the analyst to provide or correct these fields: " +
              [...v.missing, ...v.invalid].join(", ") +
              "."
          };
        }
        const txn: Transaction = {
          ...v.txn,
          id: `txn_${crypto.randomUUID()}`
        };
        try {
          return await runTriage(txn);
        } catch (e) {
          return {
            status: "error" as const,
            message: `Triage workflow failed: ${e instanceof Error ? e.message : String(e)}`
          };
        }
      }
    }),

    getAccountHistory: tool({
      description:
        "Get an account's stored transactions and fraud cases (read-only). Use when the analyst asks about an account's history, transactions or cases. Only pass limit if the analyst asked for a specific number.",
      inputSchema: accountHistoryInputSchema,
      execute: async ({ accountId, limit }) => {
        const id = accountId.trim();
        if (!id || !isGrounded("accountId", id, getUserText())) {
          return {
            status: "missing_fields" as const,
            missing: ["accountId"],
            invalid: [],
            message:
              "Ask the analyst which account to look up (for example: acct_123)."
          };
        }
        try {
          const account = await getAgentByName(env.AccountAgent, id);
          const history = await account.getHistory(clampHistoryLimit(limit));
          return { status: "ok" as const, accountId: id, ...history };
        } catch (e) {
          return {
            status: "error" as const,
            message: `Could not load account history: ${e instanceof Error ? e.message : String(e)}`
          };
        }
      }
    }),

    explainCase: tool({
      description:
        "Use when the analyst asks WHY an account, transaction or case was flagged, opened, reviewed or declined. Returns the flagged transactions with their rule hits, scores and stored explanations so you can answer briefly. Do not use it just to list or show transactions.",
      inputSchema: explainCaseInputSchema,
      execute: async ({ accountId, caseId }) => {
        const id = accountId.trim();
        if (!id || !isGrounded("accountId", id, getUserText())) {
          return {
            status: "missing_fields" as const,
            missing: ["accountId"],
            invalid: [],
            message:
              "Ask the analyst which account this is about (for example: acct_123)."
          };
        }
        // Only trust a case id the analyst actually typed.
        const wanted = caseId?.trim();
        const grounded =
          wanted && getUserText().toLowerCase().includes(wanted.toLowerCase())
            ? wanted
            : null;
        try {
          const account = await getAgentByName(env.AccountAgent, id);
          const details = await account.getCaseDetails(grounded);
          return {
            status: "ok" as const,
            accountId: id,
            ...details,
            note:
              details.cases.length === 0
                ? grounded
                  ? `No case ${grounded} exists on account ${id}.`
                  : details.totalTransactions === 0
                    ? `Account ${id} has no transactions recorded.`
                    : `Account ${id} has no flagged transactions (${details.totalTransactions} transactions, none REVIEW or DECLINE).`
                : undefined
          };
        } catch (e) {
          return {
            status: "error" as const,
            message: `Could not load case details: ${e instanceof Error ? e.message : String(e)}`
          };
        }
      }
    })
  };
}
