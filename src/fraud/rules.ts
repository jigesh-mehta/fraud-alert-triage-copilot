import type { Thresholds } from "./config";
import type { Decision, Evaluation, RuleHit, Transaction } from "./types";

/** Prior transactions for the same account. Must not include the txn being evaluated. */
export interface HistoryTxn {
  ts: number;
  amount: number;
  countryCode: string;
  decision: Decision;
}

export type Rule = (
  txn: Transaction,
  history: HistoryTxn[],
  t: Thresholds
) => RuleHit | null;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The baseline is the account's APPROVED transactions only. Including REVIEW
 * or DECLINE amounts would let one large flagged transaction inflate the
 * average and hide the next one. With no approved history there is no
 * baseline, so the rule does not fire.
 */
export const amountSpike: Rule = (txn, history, t) => {
  const approved = history.filter((h) => h.decision === "APPROVE");
  if (approved.length === 0) return null;
  const avg = approved.reduce((sum, h) => sum + h.amount, 0) / approved.length;
  const limit = Math.max(t.amountSpikeMinAbs, t.amountSpikeMultiplier * avg);
  if (txn.amount < limit) return null;
  return {
    rule: "amount_spike",
    weight: t.amountSpikeWeight,
    message: `Amount ${txn.amount} is at or above ${round2(limit)} (24h average ${round2(avg)} over ${approved.length} approved transactions)`,
    evidence: {
      amount: txn.amount,
      average: round2(avg),
      limit: round2(limit),
      approvedCount: approved.length
    }
  };
};

export const velocity: Rule = (txn, history, t) => {
  const windowStart = txn.timestamp - t.velocityWindowMin * 60_000;
  const prior = history.filter(
    (h) => h.ts >= windowStart && h.ts <= txn.timestamp
  ).length;
  const count = prior + 1;
  if (count <= t.velocityMaxCount) return null;
  return {
    rule: "velocity",
    weight: t.velocityWeight,
    message: `${count} transactions within ${t.velocityWindowMin} minutes (max ${t.velocityMaxCount})`,
    evidence: {
      count,
      windowMin: t.velocityWindowMin,
      max: t.velocityMaxCount
    }
  };
};

export const geoMismatch: Rule = (txn, history, t) => {
  if (history.length === 0) return null;
  const seen = [...new Set(history.map((h) => h.countryCode))].sort();
  if (seen.includes(txn.countryCode)) return null;
  return {
    rule: "geo_mismatch",
    weight: t.geoMismatchWeight,
    message: `Country ${txn.countryCode} not seen in recent history (${seen.join(", ")})`,
    evidence: { country: txn.countryCode, seenCountries: seen }
  };
};

export const newAccountHighAmount: Rule = (txn, history, t) => {
  if (history.length > 0 || txn.amount < t.newAccountMaxAmount) return null;
  return {
    rule: "new_account_high_amount",
    weight: t.newAccountHighAmountWeight,
    message: `No recent history and amount ${txn.amount} is at or above ${t.newAccountMaxAmount}`,
    evidence: { amount: txn.amount, limit: t.newAccountMaxAmount }
  };
};

/** Add a new rule by writing a function above and appending it here. */
export const RULES: Rule[] = [
  amountSpike,
  velocity,
  geoMismatch,
  newAccountHighAmount
];

/**
 * The only place that maps rule hits to a decision. Currently score bands;
 * change this (and config.ts) to alter what becomes REVIEW vs DECLINE.
 */
export function decide(
  score: number,
  _hits: RuleHit[],
  t: Thresholds
): Decision {
  if (score >= t.declineScore) return "DECLINE";
  if (score >= t.reviewScore) return "REVIEW";
  return "APPROVE";
}

export function evaluate(
  txn: Transaction,
  history: HistoryTxn[],
  t: Thresholds
): Evaluation {
  const hits = RULES.map((rule) => rule(txn, history, t)).filter(
    (h): h is RuleHit => h !== null
  );
  const score = hits.reduce((sum, h) => sum + h.weight, 0);
  return { score, hits, decision: decide(score, hits, t) };
}
