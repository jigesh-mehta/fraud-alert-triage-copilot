# Fraud Alert Triage Copilot

An AI copilot that helps analysts triage suspicious transactions, built on Cloudflare's [Agents SDK](https://developers.cloudflare.com/agents/).

**Status:** work in progress. The starter's demo code (MCP, image input, scheduling, sample tools) has been removed and the app is currently a plain chat on Llama 3.3. The fraud-triage logic is not built yet.

## Planned design

- **LLM:** Llama 3.3 on Workers AI explains risk and answers follow-up questions.
- **Rules and thresholds:** deterministic rules (amount spike, velocity, geo mismatch) driven by a config object.
- **Workflow:** load account history, run rules, explain with the LLM, persist the case.
- **State:** per-account case history in Durable Objects, keyed by `account_id`.
- **Input:** chat UI.

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
  server.ts    # ChatAgent (AIChatAgent on Llama 3.3)
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
| `npm run check`  | Format check, lint and typecheck            |
