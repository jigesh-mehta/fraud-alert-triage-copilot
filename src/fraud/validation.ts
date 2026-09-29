import { z } from "zod";
import type { Transaction } from "./types";

export const MANDATORY_FIELDS = ["accountId", "amount", "countryCode"] as const;

export const triageInputSchema = z.object({
  accountId: z.string().optional().describe("Account identifier (mandatory)"),
  amount: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Transaction amount, positive number (mandatory)"),
  countryCode: z
    .string()
    .optional()
    .describe("ISO 3166-1 alpha-2 country code of the transaction (mandatory)"),
  currency: z.string().optional().describe("Defaults to USD"),
  merchant: z.string().optional(),
  channel: z.string().optional(),
  timestamp: z
    .union([z.number(), z.string()])
    .optional()
    .describe("ISO 8601 string or epoch ms. Defaults to now")
});

export type TriageInput = z.infer<typeof triageInputSchema>;

export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 50;

/**
 * Llama 3.3 sends numeric arguments as strings ("limit": "50") and may ask for
 * "all" with a huge value. Accept anything here and clamp in clampHistoryLimit
 * instead of letting schema validation reject the whole tool call.
 */
export const accountHistoryInputSchema = z.object({
  accountId: z.string().describe("Account identifier"),
  limit: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      `Max rows to return (1-${HISTORY_MAX_LIMIT}, default ${HISTORY_DEFAULT_LIMIT}). Omit unless the analyst asks for a specific number or "all".`
    )
});

export const explainCaseInputSchema = z.object({
  accountId: z.string().describe("Account identifier"),
  caseId: z
    .string()
    .optional()
    .describe(
      "Case id (case_txn_...) if the analyst named one. Omit to explain the account's latest flagged transactions."
    )
});

export function clampHistoryLimit(v: unknown): number {
  const text = typeof v === "number" ? String(v) : String(v ?? "").trim();
  if (text === "") return HISTORY_DEFAULT_LIMIT;
  const n = Number(text);
  if (!Number.isFinite(n)) return HISTORY_DEFAULT_LIMIT;
  return Math.min(HISTORY_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

export type ValidationResult =
  | { ok: true; txn: Omit<Transaction, "id"> }
  | { ok: false; missing: string[]; invalid: string[] };

function parseAmount(v: unknown): number | null {
  const n =
    typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseTimestamp(v: unknown, now: number): number | null {
  if (v === undefined || v === null || v === "") return now;
  const ts = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(ts) ? ts : null;
}

function escapeRegExp(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The LLM fills tool arguments, and can invent a value the analyst never gave
 * (observed: a made-up countryCode). A mandatory value only counts if it
 * actually appears in the analyst's message.
 */
export function isGrounded(
  field: "accountId" | "amount" | "countryCode",
  value: string | number,
  sourceText: string
): boolean {
  if (field === "accountId") {
    return sourceText.toLowerCase().includes(String(value).toLowerCase());
  }
  if (field === "countryCode") {
    return new RegExp(
      `(^|[^a-z])${escapeRegExp(String(value))}([^a-z]|$)`,
      "i"
    ).test(sourceText);
  }
  const target = typeof value === "number" ? value : Number(value);
  const numbers = sourceText.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return numbers.some((n) => Number(n.replace(/,/g, "")) === target);
}

/**
 * Deterministic check that runs before any workflow is started. Missing or
 * blank mandatory fields go in `missing`; present-but-unusable values go in
 * `invalid`.
 */
export function validateTriageInput(
  raw: unknown,
  now: number = Date.now(),
  sourceText?: string
): ValidationResult {
  const parsed = triageInputSchema.safeParse(raw ?? {});
  const input: TriageInput = parsed.success ? parsed.data : {};

  const missing: string[] = [];
  const invalid: string[] = [];

  const accountId = input.accountId?.trim();
  if (!accountId) missing.push("accountId");

  const isBlank = (v: unknown) =>
    v === undefined || v === null || String(v).trim() === "";

  let amount: number | null = null;
  if (isBlank(input.amount)) missing.push("amount");
  else {
    amount = parseAmount(input.amount);
    if (amount === null) invalid.push("amount");
  }

  const country = input.countryCode?.trim().toUpperCase();
  if (!country) missing.push("countryCode");
  else if (!/^[A-Z]{2}$/.test(country)) invalid.push("countryCode");

  if (sourceText !== undefined) {
    const ungrounded = (field: string) => {
      const i = invalid.indexOf(field);
      if (i >= 0) invalid.splice(i, 1);
      if (!missing.includes(field)) missing.push(field);
    };
    if (accountId && !isGrounded("accountId", accountId, sourceText))
      ungrounded("accountId");
    if (amount !== null && !isGrounded("amount", amount, sourceText))
      ungrounded("amount");
    if (country && !isGrounded("countryCode", country, sourceText))
      ungrounded("countryCode");
  }

  const timestamp = parseTimestamp(input.timestamp, now);
  if (timestamp === null) invalid.push("timestamp");

  if (
    missing.length > 0 ||
    invalid.length > 0 ||
    !accountId ||
    amount === null ||
    !country ||
    timestamp === null
  ) {
    return { ok: false, missing, invalid };
  }

  return {
    ok: true,
    txn: {
      accountId,
      amount,
      currency: input.currency?.trim().toUpperCase() || "USD",
      countryCode: country,
      timestamp,
      merchant: input.merchant?.trim() || undefined,
      channel: input.channel?.trim() || undefined
    }
  };
}
