import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText
} from "ai";
import { LLM_MODEL } from "./fraud/explain";
import { patchWorkersAIBinding } from "./fraud/workers-ai-binding";
import { endTurnAfterCard } from "./fraud/stop";
import { buildTools, type TriageOutcome } from "./fraud/tools";
import type { Transaction, TriageResult } from "./fraud/types";

export { AccountAgent } from "./fraud/account-agent";
export { TriageWorkflow } from "./fraud/triage-workflow";

const TRIAGE_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are a fraud alert triage copilot helping a fraud analyst.

Transactions: when the analyst provides a transaction (free text or JSON), call triageTransaction. The mandatory fields are accountId, amount and countryCode (2-letter ISO code). Optional: currency, merchant, channel, timestamp. Only pass values the analyst actually gave you. NEVER guess or fill in a mandatory field. If the tool returns status "missing_fields", tell the analyst exactly which fields are missing or invalid, show the expected format (for example: acct_123, 4500, GB), and do not describe any decision.

Two kinds of request, two different behaviours:
1. SHOW data ("show", "list", "display", "info about", "history", "transactions", or a bare transaction to triage): call triageTransaction or getAccountHistory. The UI renders the result as a card or table, so write NO text after it. Omit the limit unless they ask for a specific number.
2. EXPLAIN ("why", "reason", "explain", "how come", "what triggered", including a case id or "why was account X flagged"): call explainCase, then answer in 2-4 short sentences. State the decision, the rules that fired with their numbers (amount, average, count, countries), and the case id. Use only the tool result. Say "transaction" for what was flagged, not "account". Do not repeat a full table, and do not call getAccountHistory for these questions. If explainCase returns no cases, say the account has no flagged transactions.

The decision (APPROVE, REVIEW or DECLINE), score and rule hits come only from tool results. Never invent rules, numbers or decisions and never change a decision.

If a tool returns status "missing_fields", tell the analyst exactly which fields are missing or invalid and show the expected format (for example: acct_123, 4500, GB). If it returns "error" or "pending", say so in one sentence. Never print JSON or tool-call syntax in your reply.

Follow-up questions about something already shown: if the earlier tool result in this conversation has the answer, explain briefly from it; otherwise call explainCase.`;

interface Waiter {
  resolve: (r: TriageOutcome) => void;
  reject: (e: Error) => void;
}

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  private waiters = new Map<string, Waiter>();
  // Completion can be delivered before runTriage registers its waiter.
  private early = new Map<string, TriageResult | Error>();

  /** Starts the triage workflow and waits for its result (bounded by a timeout). */
  async runTriage(txn: Transaction): Promise<TriageOutcome> {
    const workflowId = await this.runWorkflow("TRIAGE_WORKFLOW", txn);

    const early = this.early.get(workflowId);
    if (early) {
      this.early.delete(workflowId);
      if (early instanceof Error) throw early;
      return { status: "ok", ...early };
    }

    return new Promise<TriageOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(workflowId);
        resolve({
          status: "pending",
          workflowId,
          message:
            "Triage is still running; results will be stored on the account."
        });
      }, TRIAGE_TIMEOUT_MS);
      this.waiters.set(workflowId, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  }

  private latestUserText(): string {
    const last = [...this.messages].reverse().find((m) => m.role === "user");
    return (
      last?.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ") ?? ""
    );
  }

  async onWorkflowComplete(
    _workflowName: string,
    workflowId: string,
    result?: unknown
  ) {
    const triage = result as TriageResult;
    const waiter = this.waiters.get(workflowId);
    if (waiter) {
      this.waiters.delete(workflowId);
      waiter.resolve({ status: "ok", ...triage });
    } else {
      this.early.set(workflowId, triage);
    }
  }

  async onWorkflowError(
    _workflowName: string,
    workflowId: string,
    error: string
  ) {
    const err = new Error(error);
    const waiter = this.waiters.get(workflowId);
    if (waiter) {
      this.waiters.delete(workflowId);
      waiter.reject(err);
    } else {
      this.early.set(workflowId, err);
    }
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({
      binding: patchWorkersAIBinding(this.env.AI)
    });

    const result = streamText({
      model: workersai(LLM_MODEL, {
        sessionAffinity: this.sessionAffinity
      }),
      system: SYSTEM_PROMPT,
      // Prune old tool calls and reasoning to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      tools: buildTools({
        env: this.env,
        runTriage: (txn) => this.runTriage(txn),
        getUserText: () => this.latestUserText()
      }),
      // One tool call per turn: Llama 3.3 otherwise re-calls the tool instead
      // of answering, which would triage the same transaction repeatedly.
      prepareStep: ({ stepNumber }) =>
        stepNumber > 0 ? { activeTools: [] } : undefined,
      // A successful tool result is shown as a card, so end the turn there
      // with no follow-up prose. Other statuses (missing_fields, error,
      // pending) still get one reply from the model.
      stopWhen: [stepCountIs(2), endTurnAfterCard],
      abortSignal: options?.abortSignal
    });

    // Without onError the stream masks tool failures as "An error occurred."
    return result.toUIMessageStreamResponse({
      onError: (e) => (e instanceof Error ? e.message : String(e))
    });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
