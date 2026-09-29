import { Agent } from "agents";
import type { HistoryTxn } from "./rules";
import type {
  CaseDetail,
  CaseRecord,
  Decision,
  RuleHit,
  StoredTransaction,
  TriageResult
} from "./types";

interface TxnRow {
  id: string;
  ts: number;
  amount: number;
  currency: string;
  country: string;
  merchant: string | null;
  channel: string | null;
  decision: Decision;
  score: number;
  hits_json: string;
}

interface CaseRow {
  id: string;
  txn_id: string;
  ts: number;
  decision: Decision;
  score: number;
  hits_json: string;
  explanation: string;
  status: string;
}

/**
 * One instance per accountId. Owns that account's transaction and case
 * history. Reached from the workflow and chat tools via getAgentByName.
 */
export class AccountAgent extends Agent<Env> {
  async onStart() {
    this.sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        country TEXT NOT NULL,
        merchant TEXT,
        channel TEXT,
        decision TEXT NOT NULL,
        score INTEGER NOT NULL,
        hits_json TEXT NOT NULL
      )`;
    this.sql`CREATE INDEX IF NOT EXISTS idx_txn_ts ON transactions (ts)`;
    this.sql`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        txn_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        decision TEXT NOT NULL,
        score INTEGER NOT NULL,
        hits_json TEXT NOT NULL,
        explanation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open'
      )`;
  }

  /** Transactions at or after `sinceMs`, optionally excluding one (workflow retries). */
  getRecentTransactions(sinceMs: number, excludeId?: string): HistoryTxn[] {
    const rows = this.sql<
      Pick<TxnRow, "ts" | "amount" | "country" | "decision">
    >`
      SELECT ts, amount, country, decision FROM transactions
      WHERE ts >= ${sinceMs} AND id != ${excludeId ?? ""}
      ORDER BY ts DESC`;
    return rows.map((r) => ({
      ts: r.ts,
      amount: r.amount,
      countryCode: r.country,
      decision: r.decision
    }));
  }

  /**
   * Idempotent on the transaction id: a workflow retry does not duplicate
   * the transaction or its case. REVIEW/DECLINE open a case.
   */
  recordTriage(result: TriageResult): { caseId: string | null } {
    const { transaction: t, decision, score, hits, explanation } = result;
    const hitsJson = JSON.stringify(hits);

    this.sql`
      INSERT OR IGNORE INTO transactions
        (id, ts, amount, currency, country, merchant, channel, decision, score, hits_json)
      VALUES
        (${t.id}, ${t.timestamp}, ${t.amount}, ${t.currency}, ${t.countryCode},
         ${t.merchant ?? null}, ${t.channel ?? null}, ${decision}, ${score}, ${hitsJson})`;

    if (decision === "APPROVE") return { caseId: null };

    const caseId = `case_${t.id}`;
    this.sql`
      INSERT OR IGNORE INTO cases
        (id, txn_id, ts, decision, score, hits_json, explanation)
      VALUES
        (${caseId}, ${t.id}, ${Date.now()}, ${decision}, ${score}, ${hitsJson}, ${explanation})`;
    return { caseId };
  }

  /** Cases with their opening transaction. One case by id, or the latest few. */
  getCaseDetails(
    caseId: string | null,
    limit = 5
  ): { cases: CaseDetail[]; totalCases: number; totalTransactions: number } {
    type Row = CaseRow & {
      amount: number;
      currency: string;
      country: string;
      txn_ts: number;
      merchant: string | null;
      channel: string | null;
    };
    const rows = caseId
      ? this.sql<Row>`
          SELECT c.*, t.amount, t.currency, t.country, t.ts AS txn_ts, t.merchant, t.channel
          FROM cases c JOIN transactions t ON t.id = c.txn_id
          WHERE c.id = ${caseId}`
      : this.sql<Row>`
          SELECT c.*, t.amount, t.currency, t.country, t.ts AS txn_ts, t.merchant, t.channel
          FROM cases c JOIN transactions t ON t.id = c.txn_id
          ORDER BY c.ts DESC LIMIT ${limit}`;
    const count = (n: { n: number }[]) => n[0]?.n ?? 0;
    return {
      totalCases: count(
        this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM cases`
      ),
      totalTransactions: count(
        this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM transactions`
      ),
      cases: rows.map((r) => ({
        caseId: r.id,
        status: r.status,
        decision: r.decision,
        score: r.score,
        hits: JSON.parse(r.hits_json) as RuleHit[],
        explanation: r.explanation,
        transaction: {
          id: r.txn_id,
          ts: r.txn_ts,
          amount: r.amount,
          currency: r.currency,
          countryCode: r.country,
          merchant: r.merchant,
          channel: r.channel
        }
      }))
    };
  }

  getHistory(limit = 20): {
    transactions: StoredTransaction[];
    cases: CaseRecord[];
    totalTransactions: number;
    totalCases: number;
  } {
    const count = (n: { n: number }[]) => n[0]?.n ?? 0;
    const totalTransactions = count(
      this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM transactions`
    );
    const totalCases = count(
      this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM cases`
    );
    const txns = this.sql<TxnRow>`
      SELECT * FROM transactions ORDER BY ts DESC LIMIT ${limit}`;
    const cases = this.sql<CaseRow>`
      SELECT * FROM cases ORDER BY ts DESC LIMIT ${limit}`;
    return {
      totalTransactions,
      totalCases,
      transactions: txns.map((r) => ({
        id: r.id,
        ts: r.ts,
        amount: r.amount,
        currency: r.currency,
        countryCode: r.country,
        merchant: r.merchant,
        channel: r.channel,
        decision: r.decision,
        score: r.score,
        hits: JSON.parse(r.hits_json) as RuleHit[]
      })),
      cases: cases.map((r) => ({
        id: r.id,
        txnId: r.txn_id,
        ts: r.ts,
        decision: r.decision,
        score: r.score,
        hits: JSON.parse(r.hits_json) as RuleHit[],
        explanation: r.explanation,
        status: r.status
      }))
    };
  }
}
