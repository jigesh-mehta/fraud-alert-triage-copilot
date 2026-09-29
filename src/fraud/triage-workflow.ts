import { getAgentByName } from "agents";
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { THRESHOLDS } from "./config";
import { explainRisk, fallbackExplanation } from "./explain";
import { evaluate } from "./rules";
import type { ChatAgent } from "../server";
import type { Transaction, TriageResult } from "./types";

export class TriageWorkflow extends AgentWorkflow<ChatAgent, Transaction> {
  async run(event: AgentWorkflowEvent<Transaction>, step: AgentWorkflowStep) {
    const txn = event.payload;
    const account = () => getAgentByName(this.env.AccountAgent, txn.accountId);

    const history = await step.do("load-history", async () => {
      const since = txn.timestamp - THRESHOLDS.historyWindowHours * 3_600_000;
      return (await account()).getRecentTransactions(since, txn.id);
    });
    await this.reportProgress({ step: "load-history", status: "complete" });

    const evaluation = await step.do("run-rules", async () =>
      evaluate(txn, history, THRESHOLDS)
    );
    await this.reportProgress({ step: "run-rules", status: "complete" });

    const explanation = await step
      .do(
        "explain",
        { retries: { limit: 2, delay: "2 seconds", backoff: "constant" } },
        async () =>
          explainRisk(
            this.env,
            txn,
            evaluation.hits,
            evaluation.decision,
            evaluation.score,
            history
          )
      )
      .catch(() => fallbackExplanation(evaluation.decision, evaluation.hits));
    await this.reportProgress({ step: "explain", status: "complete" });

    const result = await step.do("persist", async () => {
      const partial: TriageResult = {
        transaction: txn,
        ...evaluation,
        explanation,
        caseId: null
      };
      const { caseId } = await (await account()).recordTriage(partial);
      return { ...partial, caseId };
    });

    await step.reportComplete(result);
    return result;
  }
}
