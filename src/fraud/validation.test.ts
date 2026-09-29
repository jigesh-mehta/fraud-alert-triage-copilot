import { describe, expect, it } from "vitest";
import {
  accountHistoryInputSchema,
  clampHistoryLimit,
  validateTriageInput
} from "./validation";

const NOW = 1_800_000_000_000;

describe("validateTriageInput", () => {
  it("accepts a minimal valid payload and applies defaults", () => {
    const r = validateTriageInput(
      { accountId: "acct_1", amount: 4500, countryCode: "gb" },
      NOW
    );
    expect(r).toEqual({
      ok: true,
      txn: {
        accountId: "acct_1",
        amount: 4500,
        currency: "USD",
        countryCode: "GB",
        timestamp: NOW,
        merchant: undefined,
        channel: undefined
      }
    });
  });

  it("reports each missing mandatory field", () => {
    const r = validateTriageInput({}, NOW);
    expect(r).toEqual({
      ok: false,
      missing: ["accountId", "amount", "countryCode"],
      invalid: []
    });
  });

  it("treats blank strings as missing", () => {
    const r = validateTriageInput(
      { accountId: "  ", amount: "", countryCode: "" },
      NOW
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.missing).toEqual(["accountId", "amount", "countryCode"]);
  });

  it("reports only the missing field", () => {
    const r = validateTriageInput({ accountId: "a", amount: 900 }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["countryCode"]);
  });

  it("coerces amount strings like '$4,500.50'", () => {
    const r = validateTriageInput(
      { accountId: "a", amount: "$4,500.50", countryCode: "US" },
      NOW
    );
    expect(r.ok && r.txn.amount).toBe(4500.5);
  });

  it("rejects non-numeric, zero and negative amounts", () => {
    for (const amount of ["abc", 0, -5]) {
      const r = validateTriageInput(
        { accountId: "a", amount, countryCode: "US" },
        NOW
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.invalid).toContain("amount");
    }
  });

  it("rejects a country code that is not two letters", () => {
    const r = validateTriageInput(
      { accountId: "a", amount: 1, countryCode: "USA" },
      NOW
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.invalid).toContain("countryCode");
  });

  it("parses ISO timestamps and rejects garbage", () => {
    const ok = validateTriageInput(
      {
        accountId: "a",
        amount: 1,
        countryCode: "US",
        timestamp: "2026-09-29T12:00:00Z"
      },
      NOW
    );
    expect(ok.ok && ok.txn.timestamp).toBe(Date.UTC(2026, 8, 29, 12));

    const bad = validateTriageInput(
      { accountId: "a", amount: 1, countryCode: "US", timestamp: "nope" },
      NOW
    );
    expect(bad.ok).toBe(false);
  });

  describe("grounding against the analyst's message", () => {
    const ok = { accountId: "acct_E", amount: 900, countryCode: "US" };

    it("treats a value the analyst never typed as missing", () => {
      // Observed with Llama 3.3: it filled in countryCode "US" on its own.
      const r = validateTriageInput(ok, NOW, "acct_E, 900");
      expect(r).toEqual({ ok: false, missing: ["countryCode"], invalid: [] });
    });

    it("accepts values present in the message", () => {
      expect(validateTriageInput(ok, NOW, "acct_E, 900, US").ok).toBe(true);
      expect(validateTriageInput(ok, NOW, "acct_e $900 us").ok).toBe(true);
    });

    it("matches formatted amounts and JSON input", () => {
      const r = validateTriageInput(
        { accountId: "a1", amount: 4500, countryCode: "GB" },
        NOW,
        '{"accountId":"a1","amount":4,500,"countryCode":"GB"} or $4,500.00'
      );
      expect(r.ok).toBe(true);
    });

    it("does not match a country code inside another word", () => {
      const r = validateTriageInput(ok, NOW, "acct_E, 900, business trip");
      expect(r.ok).toBe(false);
    });

    it("does not match an amount that is only a substring of another number", () => {
      const r = validateTriageInput(ok, NOW, "acct_E, 9000, US");
      expect(r).toEqual({ ok: false, missing: ["amount"], invalid: [] });
    });
  });
});

describe("account history input", () => {
  it("accepts the string limit Llama sends (the reported failure)", () => {
    const r = accountHistoryInputSchema.safeParse({
      accountId: "account_1000",
      limit: "50"
    });
    expect(r.success).toBe(true);
  });

  it("accepts numeric and omitted limits", () => {
    expect(
      accountHistoryInputSchema.safeParse({ accountId: "a", limit: 10 }).success
    ).toBe(true);
    expect(
      accountHistoryInputSchema.safeParse({ accountId: "a" }).success
    ).toBe(true);
  });

  it("clamps the limit to 1-50 and defaults on garbage", () => {
    expect(clampHistoryLimit("50")).toBe(50);
    expect(clampHistoryLimit(1000)).toBe(50);
    expect(clampHistoryLimit("1000")).toBe(50);
    expect(clampHistoryLimit(0)).toBe(1);
    expect(clampHistoryLimit(-5)).toBe(1);
    expect(clampHistoryLimit(7.9)).toBe(7);
    expect(clampHistoryLimit(undefined)).toBe(20);
    expect(clampHistoryLimit("all")).toBe(20);
    expect(clampHistoryLimit("")).toBe(20);
  });
});
