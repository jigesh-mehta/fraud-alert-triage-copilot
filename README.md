# Fraud Alert Triage Copilot

An AI copilot that helps analysts triage suspicious transactions, built on Cloudflare's [Agents SDK](https://developers.cloudflare.com/agents/).

## How it works

1. The analyst sends a transaction in chat as text or JSON, for example `acct_123, 4500, GB`.
   **Required:** `accountId`, `amount`, `countryCode` (2-letter). **Optional:** `currency` (default USD), `merchant`, `channel`, `timestamp`.
2. `triageTransaction` validates the fields deterministically. A field that is missing, invalid, or not actually present in the analyst's message is reported back and nothing else runs.
3. `TriageWorkflow` (a Cloudflare Workflow) loads the account's last 24h from its `AccountAgent` Durable Object, runs the rules, asks Llama 3.3 to explain the result, and stores it.
4. REVIEW and DECLINE open a case on the account. Rules decide; the LLM only explains.
5. "Show history for acct_123" reads the account's stored transactions and cases.

Rules and thresholds live in `src/fraud/rules.ts` and `src/fraud/config.ts`. What counts as REVIEW vs DECLINE is decided in one place, `decide()`.

## Prompt history

The AI-assisted build conversation (prompts, decisions and outcomes) is in [`prompt-history/chat-history.md`](./prompt-history/chat-history.md). It has been redacted: no keys, account IDs, personal information or local paths.

## Run locally

```bash
npm install
npm run dev
```

> **Cloudflare authentication is required to run locally.** Workers AI is configured
> with `"ai": { "remote": true }` in `wrangler.jsonc` and has no local simulator, so
> `npm run dev` needs `wrangler login` or a `CLOUDFLARE_API_TOKEN` environment variable.

Open [http://localhost:5173](http://localhost:5173).

## Project structure

```
src/
  server.ts    # ChatAgent (AIChatAgent on Llama 3.3) + tools wiring
  fraud/
    config.ts            # THRESHOLDS
    rules.ts             # rules, evaluate(), decide()
    validation.ts        # mandatory-field validation and grounding
    account-agent.ts     # per-account Durable Object (SQLite)
    triage-workflow.ts   # Workflow: history -> rules -> explain -> persist
    explain.ts           # Llama 3.3 explanation
    tools.ts             # chat tools
    workers-ai-binding.ts # workaround for duplicated streaming chunks
  app.tsx      # Chat UI built with Kumo components
  client.tsx   # React entry point
  styles.css   # Tailwind + Kumo styles
```

## Commands

| Command          | Purpose                                     |
| ---------------- | ------------------------------------------- |
| `npm run dev`    | Local development                           |
| `npm run deploy` | Build and deploy to Cloudflare              |
| `npm run types`  | Regenerate `env.d.ts` after binding changes |
| `npm test`       | Unit tests (rules and validation)           |
| `npm run check`  | Format check, lint and typecheck            |
