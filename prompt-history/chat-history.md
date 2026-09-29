# Prompt history: building the Fraud Alert Triage Copilot

This is the AI-assisted build conversation for this project (Claude Code, Sonnet 5.5), condensed into the analyst's prompts in order, each followed by what was done. Prompts are verbatim except that typos were left as written.

Redaction: no API keys, tokens, Cloudflare account IDs, e-mail addresses, personal names or local file-system paths are included. Account IDs such as `acct_123` and `account_1000` are made-up test data.

---

## 1. Initial requirements

> So i want to build an Fraud alert triage copilot AI application based on following conditions to be met using the current starter project as the base --
>
> An AI-powered application should include the following components:
> LLM using Llama 3.3 on Workers AI
> Workflow / coordination (recommend using Workflows, Workers or Durable Objects)
> User input via chat or voice (recommend using Pages or Realtime)
> Memory or state
>
> I am thinking the following use for each --
> LLM - Llama 3.3 on Workers AI writes the risk explanation and answers follow-up questions.
> Rules -- basic rules configured in system like amount_spike since historical transactions in 24hours, velocity, geo_mismatch etc.
> Thresholds -- configured in some config object which are used by rules
> Workflow -- we have a set steps like -- based on input transaction load history of that account, run rules on it, call LLM to explain for human readable format, return that response and also save the case to Durable Object. To keep it simple we will only use account_id as our primary attribute to relate transactions.
> Input -- The Chat UI would be used to input transaction and another use case would be for analyst to know history about a particular account or something like that (TBD).
> State -- as already discussed we will keep account case history. Potentially we can create a new case when it is a review or decline transaction.
>
> In order to implement this, first need to remove all the unrelated code from this starter repo - like mcp tool config, image related processing or code etc. Then need to build a plan to implement this Fraud alert triage application.

**Outcome:** Explored the starter (Agents SDK chat app with MCP, image input, scheduling and demo tools), verified the Llama 3.3 model ID and the Agents/Workflows API against current Cloudflare docs, and drafted a plan in two parts: cleanup, then the fraud triage build.

## 2. Scope the work

> First focus on part 1 of this -- cleanup. Once that is complete i want to figure out more details about part 2 and once that is finalized then i will tell you to implement that plan.

**Outcome:** Cleanup only. Removed MCP, image attachments, scheduling and the demo tools from `src/server.ts` and `src/app.tsx`, switched the model to Llama 3.3, dropped unused babel plugins and the `/oauth/*` route, and rewrote the README. Lint, typecheck and build passed.

## 3. Commit, then design

> First commit the staged changes and then lets work on part 2.

**Outcome:** Committed the cleanup, then asked design questions before implementing.

## 4. Design decisions (answers to questions)

- **Input format:** "We can go with Free text/JSON but we need to have a few mandatory fields sent with the payload like amount, account id, country code. If mandatory fields are missing then we reply back with missing field response and do not trigger rest of the workflow. We can mention the format in the helper text."
- **Geo rule:** country code mismatch.
- **Account history:** read-only.
- **Tests:** vitest for the rules engine.

Follow-up:

> yes, what you have is good. But later i want to implement slightly different rules to mark transaction as REVIEW and some as DECLINE based on certain threshold. Initial draft of rules is okay as is. I would like to test it first if the functionality works. Can you share your entire implementation plan now?

**Outcome:** Full plan written: a per-account Durable Object for state, a Cloudflare Workflow for the steps, deterministic rules with a single `decide()` function so REVIEW/DECLINE logic is easy to change later, and Llama only explaining. Plan approved.

## 5. Implementation and live testing

**Outcome:** Built the rules engine, validation, `AccountAgent` Durable Object, `TriageWorkflow`, the chat tools and UI cards, with 25 unit tests. Live testing against Workers AI found and fixed three problems:

1. `workers-ai-provider` 3.3.1 emitted each streamed chunk twice with Llama 3.3, breaking tool calls and garbling text. Fixed with a small binding wrapper (chose the local workaround over a multi-package upgrade).
2. The model called the triage tool repeatedly in one turn. Limited to one tool call per turn.
3. The model invented a missing country code. Added a check that each mandatory value actually appears in the analyst's message.

## 6. Bug: history tool error

> Getting "getAccountHistory failed: An error occurred." when "info about account_1000" and "display all transactions of account_1000" asked in chat. I think its not able to get data from db. Can you check?

Follow-up after a plan-mode reproduction was not possible:

> i already have server running, can you check again? You are right, the issue is not with DB connection. I tried a different prompt like "show history of account_1000" and it gave me the output correctly. So issue is with processing of certain prompts.

**Outcome:** Reproduced on the running server. The database was fine. The model sent `limit` as the string `"50"` and the tool schema required a number, so validation rejected the call. Fixed by accepting strings and clamping the limit, returning totals so truncation is visible, catching tool errors, and surfacing real error messages.

## 7. Table only, no long text

> also, i dont want it to display the entire huge text explaining the transaction details when not asked. Just displaying it in table format is enough in the first response.

**Outcome:** The turn now ends after a successful triage or history result, so only the card or table is shown.

> i tested it from Chat UI and it is now working as expected. Showing transactions correctly.

## 8. Explanations on request

> i tested prompts like "why "case_txn_318c0630-1a37-41d9-8ae8-e7bd55aa2ecd" opened for account_1000?" and "why was account_1000 flagged?" but now it only displays the table with transaction info. It should in this case display the reason in short text instead of just showing the table. So when there are 2 cases -- show transaction info about an account which displays table and another case about using the data LLM giving a brief explanation why was certain account flagged. Does it make sense? let me know if unclear. I think currently its only working for case 1 regardless of the prompt.

**Outcome:** Added an `explainCase` tool. "Show" requests return the table only; "why" requests return a 2-4 sentence explanation from the stored rule hits. A case id alone cannot be resolved because each account's data is in its own Durable Object, so the account must also be named.

## 9. Rule fix

> one last thing to fix -- the amount spike rule is using all transactions amounts for that account, even the declined ones which is causing the allowed amount average to be very high if a large declined transaction comes in. So need to fix that rule to only include approved transactions.

**Outcome:** `amount_spike` now averages only APPROVED transactions. Added tests and verified live: with a 900,000 declined transaction in history, a later 4,500 was still flagged against a baseline of 42.5. Noted two remaining gaps (no approved history means no spike baseline; the geo rule still counts countries from flagged transactions).

## 10. Commits

> i want to commit changes but split across functionality, give me options

Chose "By layer, 5 commits": test tooling, rules and validation, account storage and workflow, chat agent wiring, UI and docs. Each commit was verified to typecheck and pass tests in a temporary worktree.

## 11. Requirements check and Pages question

> one final check -- can you verify the AI application meets the initial requirements i shared?

**Outcome:** All four required components verified against the code (Llama 3.3, Workflow plus Durable Objects, chat UI, Durable Object state). Caveats listed: not deployed, the LLM-failure fallback untested, the provider workaround, and rule gaps.

> can you explain what would differ with Cloudflare pages for user input via chat? is it deploying on cloudflare using "npm run deploy"?

**Outcome:** The app deploys as a single Worker with static assets via `npm run deploy` (`vite build && wrangler deploy`). Pages would require a separate Worker for the Durable Objects and Workflow, and Cloudflare recommends Workers for full-stack apps.

## 12. Housekeeping

> nope, can you push the code to main

**Outcome:** Not possible yet: the repo had no remote and no `main` branch, so a remote URL is needed.

> can you create prompt-history folder in this project and include our current chat history in it? Make sure to not have any API keys, account IDs or any PII info in it. Mention it in the readme file so that its visible.

**Outcome:** This file.

---

## Key takeaways from the build

- Rules decide and the LLM only explains, so decisions are deterministic and auditable.
- LLM tool arguments cannot be trusted: validate them, check that mandatory values appear in the user's message, and accept loosely typed numbers.
- Live testing against the real model found problems that unit tests could not (duplicated stream chunks, repeated tool calls, invented fields, string-typed numbers).
- Separate tools for "show data" (card only) and "explain" (short text) keep replies short and predictable.
