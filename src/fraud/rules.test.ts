import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "./config";
import {
  amountSpike,
  decide,
  evaluate,
  geoMismatch,
  newAccountHighAmount,
  velocity,
  type HistoryTxn
} from "./rules";
import type { Transaction } from "./types";

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const MIN = 60_000;

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "t_new",
    accountId: "acct_123",
    amount: 40,
    currency: "USD",
    countryCode: "US",
    timestamp: NOW,
    ...over
  };
}

function hist(n: number, over: Partial<HistoryTxn> = {}): HistoryTxn[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: NOW - (i + 1) * 60 * MIN,
    amount: 40,
    countryCode: "US",
    decision: "APPROVE",
    ...over
  }));
}

describe("amount_spike", () => {
  it("does not fire without history", () => {
    expect(amountSpike(txn({ amount: 9999 }), [], THRESHOLDS)).toBeNull();
  });

  it("uses the absolute floor when the average is small", () => {
    const h = hist(3); // avg 40 → 5x = 200, floor 500 wins
    expect(amountSpike(txn({ amount: 499 }), h, THRESHOLDS)).toBeNull();
    expect(amountSpike(txn({ amount: 500 }), h, THRESHOLDS)?.rule).toBe(
      "amount_spike"
    );
  });

  it("uses the multiplier when the average is large", () => {
    const h = hist(3, { amount: 400 }); // 5x = 2000 > floor
    expect(amountSpike(txn({ amount: 1999 }), h, THRESHOLDS)).toBeNull();
    expect(amountSpike(txn({ amount: 2000 }), h, THRESHOLDS)).not.toBeNull();
  });
});

describe("amount_spike baseline (approved transactions only)", () => {
  it("is not inflated by a large DECLINE in history", () => {
    // Approved avg 40 → limit is the 500 floor. A 100,000 DECLINE must not
    // raise the average to ~25,000 (limit 125,000) and let 4,500 through.
    const h = [
      ...hist(3),
      ...hist(1, { amount: 100_000, decision: "DECLINE" })
    ];
    const hit = amountSpike(txn({ amount: 4500 }), h, THRESHOLDS);
    expect(hit?.rule).toBe("amount_spike");
    expect(hit?.evidence.average).toBe(40);
    expect(hit?.evidence.approvedCount).toBe(3);
  });

  it("also ignores REVIEW amounts", () => {
    const h = [...hist(2), ...hist(1, { amount: 50_000, decision: "REVIEW" })];
    expect(
      amountSpike(txn({ amount: 4500 }), h, THRESHOLDS)?.evidence.average
    ).toBe(40);
  });

  it("does not fire when the account has no approved history", () => {
    const h = hist(3, { amount: 900, decision: "DECLINE" });
    expect(amountSpike(txn({ amount: 99_999 }), h, THRESHOLDS)).toBeNull();
  });

  it("still uses APPROVE amounts for the multiplier", () => {
    const h = [
      ...hist(3, { amount: 400 }),
      ...hist(1, { decision: "DECLINE", amount: 1 })
    ];
    expect(amountSpike(txn({ amount: 1999 }), h, THRESHOLDS)).toBeNull();
    expect(amountSpike(txn({ amount: 2000 }), h, THRESHOLDS)).not.toBeNull();
  });
});

describe("velocity", () => {
  const recent = (n: number): HistoryTxn[] =>
    Array.from({ length: n }, (_, i) => ({
      ts: NOW - (i + 1) * MIN,
      amount: 10,
      countryCode: "US",
      decision: "APPROVE"
    }));

  it("does not fire at the max count (prior + current = 5)", () => {
    expect(velocity(txn(), recent(4), THRESHOLDS)).toBeNull();
  });

  it("fires when the count exceeds the max (prior + current = 6)", () => {
    expect(velocity(txn(), recent(5), THRESHOLDS)?.rule).toBe("velocity");
  });

  it("ignores transactions outside the window", () => {
    const old = hist(10); // one per hour, all outside 10 minutes
    expect(velocity(txn(), old, THRESHOLDS)).toBeNull();
  });
});

describe("geo_mismatch", () => {
  it("does not fire without history", () => {
    expect(geoMismatch(txn({ countryCode: "GB" }), [], THRESHOLDS)).toBeNull();
  });

  it("does not fire for a country already seen", () => {
    const h = [...hist(2), ...hist(1, { countryCode: "GB" })];
    expect(geoMismatch(txn({ countryCode: "GB" }), h, THRESHOLDS)).toBeNull();
  });

  it("fires for a new country", () => {
    const hit = geoMismatch(txn({ countryCode: "GB" }), hist(2), THRESHOLDS);
    expect(hit?.rule).toBe("geo_mismatch");
    expect(hit?.evidence.seenCountries).toEqual(["US"]);
  });
});

describe("new_account_high_amount", () => {
  it("fires only with no history and amount at/above the limit", () => {
    expect(
      newAccountHighAmount(txn({ amount: 4999 }), [], THRESHOLDS)
    ).toBeNull();
    expect(
      newAccountHighAmount(txn({ amount: 5000 }), [], THRESHOLDS)?.rule
    ).toBe("new_account_high_amount");
    expect(
      newAccountHighAmount(txn({ amount: 9000 }), hist(1), THRESHOLDS)
    ).toBeNull();
  });
});

describe("decide", () => {
  it("maps score bands to decisions", () => {
    expect(decide(0, [], THRESHOLDS)).toBe("APPROVE");
    expect(decide(29, [], THRESHOLDS)).toBe("APPROVE");
    expect(decide(30, [], THRESHOLDS)).toBe("REVIEW");
    expect(decide(69, [], THRESHOLDS)).toBe("REVIEW");
    expect(decide(70, [], THRESHOLDS)).toBe("DECLINE");
  });
});

describe("evaluate", () => {
  it("approves a normal transaction", () => {
    const r = evaluate(txn(), hist(3), THRESHOLDS);
    expect(r).toEqual({ score: 0, hits: [], decision: "APPROVE" });
  });

  it("approves a new account with a normal amount", () => {
    expect(evaluate(txn(), [], THRESHOLDS).decision).toBe("APPROVE");
  });

  it("reviews a new account with a very large amount", () => {
    const r = evaluate(txn({ amount: 6000 }), [], THRESHOLDS);
    expect(r.decision).toBe("REVIEW");
    expect(r.hits.map((h) => h.rule)).toEqual(["new_account_high_amount"]);
  });

  it("reviews a geo mismatch alone", () => {
    const r = evaluate(txn({ countryCode: "GB" }), hist(3), THRESHOLDS);
    expect(r.decision).toBe("REVIEW");
    expect(r.score).toBe(30);
  });

  it("declines a large foreign spike (spike + geo)", () => {
    const r = evaluate(
      txn({ amount: 4500, countryCode: "GB" }),
      hist(3),
      THRESHOLDS
    );
    expect(r.decision).toBe("DECLINE");
    expect(r.hits.map((h) => h.rule)).toEqual(["amount_spike", "geo_mismatch"]);
    expect(r.score).toBe(70);
  });

  it("honors custom thresholds", () => {
    const strict = { ...THRESHOLDS, reviewScore: 10, declineScore: 30 };
    expect(evaluate(txn({ countryCode: "GB" }), hist(3), strict).decision).toBe(
      "DECLINE"
    );
  });
});
