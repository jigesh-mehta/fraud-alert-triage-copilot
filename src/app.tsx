import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { ChatAgent } from "./server";
import type {
  CaseRecord,
  Decision,
  RuleHit,
  StoredTransaction,
  TriageResult
} from "./fraud/types";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  PoweredByCloudflare,
  Surface,
  Switch,
  Text
} from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
  BrainIcon,
  CaretDownIcon,
  BugIcon,
  GearIcon,
  WarningIcon
} from "@phosphor-icons/react";

// ── Small components ──────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

// ── Fraud tool result cards ───────────────────────────────────────────

const DECISION_VARIANT: Record<
  Decision,
  "primary" | "secondary" | "destructive"
> = {
  APPROVE: "primary",
  REVIEW: "secondary",
  DECLINE: "destructive"
};

const DECISION_RING: Record<Decision, string> = {
  APPROVE: "ring ring-kumo-line",
  REVIEW: "ring-2 ring-kumo-warning",
  DECLINE: "ring-2 ring-kumo-danger"
};

function HitList({ hits }: { hits: RuleHit[] }) {
  if (hits.length === 0) {
    return (
      <Text size="xs" variant="secondary">
        No rules fired.
      </Text>
    );
  }
  return (
    <ul className="space-y-1">
      {hits.map((h) => (
        <li key={h.rule} className="flex items-start gap-2">
          <Badge variant="secondary">{h.rule}</Badge>
          <Text size="xs" variant="secondary">
            {h.message} (+{h.weight})
          </Text>
        </li>
      ))}
    </ul>
  );
}

function TriageResultCard({ result }: { result: TriageResult }) {
  const t = result.transaction;
  return (
    <div className="flex justify-start">
      <Surface
        className={`max-w-[85%] w-full px-4 py-3 rounded-xl ${DECISION_RING[result.decision]}`}
      >
        <div className="flex items-center gap-2 mb-2">
          <Badge variant={DECISION_VARIANT[result.decision]}>
            {result.decision}
          </Badge>
          <Text size="sm" bold>
            {t.accountId} · {t.amount} {t.currency} · {t.countryCode}
          </Text>
          <Text size="xs" variant="secondary">
            score {result.score}
          </Text>
        </div>
        <HitList hits={result.hits} />
        <div className="mt-2">
          <Text size="xs" variant="secondary">
            {result.explanation}
          </Text>
        </div>
        {result.caseId && (
          <div className="mt-2 font-mono">
            <Text size="xs" variant="secondary">
              Case opened: {result.caseId}
            </Text>
          </div>
        )}
      </Surface>
    </div>
  );
}

function AccountHistoryCard({
  accountId,
  transactions,
  cases,
  totalTransactions,
  totalCases
}: {
  accountId: string;
  transactions: StoredTransaction[];
  cases: CaseRecord[];
  totalTransactions: number;
  totalCases: number;
}) {
  return (
    <div className="flex justify-start">
      <Surface className="max-w-[85%] w-full px-4 py-3 rounded-xl ring ring-kumo-line">
        <Text size="sm" bold>
          {accountId} · {totalTransactions} transactions · {totalCases} cases
        </Text>
        {totalTransactions > transactions.length && (
          <div>
            <Text size="xs" variant="secondary">
              Showing the latest {transactions.length} of {totalTransactions}{" "}
              transactions.
            </Text>
          </div>
        )}
        {totalTransactions === 0 && totalCases === 0 && (
          <div className="mt-1">
            <Text size="xs" variant="secondary">
              No transactions or cases recorded for this account.
            </Text>
          </div>
        )}
        {transactions.length > 0 && (
          <table className="mt-2 w-full text-xs text-kumo-subtle">
            <thead>
              <tr className="text-left">
                <th className="pr-2">Time</th>
                <th className="pr-2">Amount</th>
                <th className="pr-2">Country</th>
                <th className="pr-2">Decision</th>
                <th>Rules</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((x) => (
                <tr key={x.id}>
                  <td className="pr-2">{new Date(x.ts).toLocaleString()}</td>
                  <td className="pr-2">
                    {x.amount} {x.currency}
                  </td>
                  <td className="pr-2">{x.countryCode}</td>
                  <td className="pr-2">
                    <Badge variant={DECISION_VARIANT[x.decision]}>
                      {x.decision}
                    </Badge>
                  </td>
                  <td>{x.hits.map((h) => h.rule).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cases.length > 0 && (
          <div className="mt-2 space-y-1">
            {cases.map((c) => (
              <Text key={c.id} size="xs" variant="secondary">
                {c.id} · {c.decision} · {c.status}
              </Text>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}

function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  if (part.state === "output-error") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring-2 ring-kumo-danger">
          <Text size="xs" variant="secondary">
            {toolName} failed: {part.errorText || "Tool call failed"}
          </Text>
        </Surface>
      </div>
    );
  }

  if (part.state !== "output-available") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              Running {toolName}...
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  const out = part.output as Record<string, unknown> & { status?: string };

  // explainCase feeds the assistant's short text answer; no card of its own.
  if (toolName === "explainCase" && out.status === "ok") return null;

  if (out.status === "missing_fields") {
    const fields = [
      ...((out.missing as string[] | undefined) ?? []),
      ...((out.invalid as string[] | undefined) ?? [])
    ];
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-3 rounded-xl ring-2 ring-kumo-warning">
          <div className="flex items-center gap-2">
            <WarningIcon size={14} className="text-kumo-warning" />
            <Text size="sm" bold>
              Transaction not processed
            </Text>
          </div>
          <div className="mt-1">
            <Text size="xs" variant="secondary">
              Missing or invalid: {fields.join(", ")}. Required: accountId,
              amount, countryCode.
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  if (toolName === "triageTransaction" && out.status === "ok") {
    return <TriageResultCard result={out as unknown as TriageResult} />;
  }

  if (toolName === "getAccountHistory" && out.status === "ok") {
    return (
      <AccountHistoryCard
        accountId={String(out.accountId)}
        transactions={out.transactions as StoredTransaction[]}
        cases={out.cases as CaseRecord[]}
        totalTransactions={Number(out.totalTransactions ?? 0)}
        totalCases={Number(out.totalCases ?? 0)}
      />
    );
  }

  return (
    <div className="flex justify-start">
      <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
        <Text size="xs" variant="secondary">
          {String(out.message ?? `${toolName}: ${out.status ?? "done"}`)}
        </Text>
      </Surface>
    </div>
  );
}

// ── Main chat ─────────────────────────────────────────────────────────

function Chat() {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent<ChatAgent>({
    agent: "ChatAgent",
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    )
  });

  const { messages, sendMessage, clearHistory, stop, status } = useAgentChat({
    agent,
    experimental_throttle: 100
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Re-focus the input after streaming ends
  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated relative">
      {/* Header */}
      <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-kumo-default">
              <span className="mr-2">🛡️</span>Fraud Triage Copilot
            </h1>
            <Badge variant="secondary">
              <ChatCircleDotsIcon size={12} weight="bold" className="mr-1" />
              AI Chat
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
            <div className="flex items-center gap-1.5">
              <BugIcon size={14} className="text-kumo-inactive" />
              <Switch
                checked={showDebug}
                onCheckedChange={setShowDebug}
                size="sm"
                aria-label="Toggle debug mode"
              />
            </div>
            <ThemeToggle />
            <Button
              variant="secondary"
              icon={<TrashIcon size={16} />}
              onClick={clearHistory}
            >
              Clear
            </Button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
          {messages.length === 0 && (
            <Empty
              icon={<ChatCircleDotsIcon size={32} />}
              title="Triage a transaction"
              description="Send a transaction as text or JSON. Required: accountId, amount, countryCode (2-letter). Optional: currency, merchant, channel, timestamp. Example: acct_123, 4500, GB"
              contents={
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    "acct_123, 40, US",
                    "acct_123, 4500, GB",
                    '{"accountId":"acct_123","amount":900}',
                    "Show history for acct_123"
                  ].map((prompt) => (
                    <Button
                      key={prompt}
                      variant="outline"
                      size="sm"
                      disabled={isStreaming}
                      onClick={() => {
                        sendMessage({
                          role: "user",
                          parts: [{ type: "text", text: prompt }]
                        });
                      }}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              }
            />
          )}

          {messages.map((message: UIMessage, index: number) => {
            const isUser = message.role === "user";
            const isLastAssistant =
              message.role === "assistant" && index === messages.length - 1;

            return (
              <div key={message.id} className="space-y-2">
                {showDebug && (
                  <pre className="text-[11px] text-kumo-subtle bg-kumo-control rounded-lg p-3 overflow-auto max-h-64">
                    {JSON.stringify(message, null, 2)}
                  </pre>
                )}

                {/* Render parts in chronological (array) order */}
                {message.parts.map((part, i) => {
                  const key = `${message.id}-${i}`;

                  if (isToolUIPart(part)) {
                    return <ToolPartView key={key} part={part} />;
                  }

                  if (part.type === "reasoning") {
                    if (!part.text.trim()) return null;
                    const isDone = part.state === "done" || !isStreaming;
                    return (
                      <div key={key} className="flex justify-start">
                        <details className="max-w-[85%] w-full" open={!isDone}>
                          <summary className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm select-none">
                            <BrainIcon size={14} className="text-purple-400" />
                            <span className="font-medium text-kumo-default">
                              Reasoning
                            </span>
                            {isDone ? (
                              <span className="text-xs text-kumo-success">
                                Complete
                              </span>
                            ) : (
                              <span className="text-xs text-kumo-brand">
                                Thinking...
                              </span>
                            )}
                            <CaretDownIcon
                              size={14}
                              className="ml-auto text-kumo-inactive"
                            />
                          </summary>
                          <pre className="mt-2 px-3 py-2 rounded-lg bg-kumo-control text-xs text-kumo-default whitespace-pre-wrap overflow-auto max-h-64">
                            {part.text}
                          </pre>
                        </details>
                      </div>
                    );
                  }

                  if (part.type === "text") {
                    if (!part.text) return null;

                    if (isUser) {
                      return (
                        <div key={key} className="flex justify-end">
                          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
                            {part.text}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={key} className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                          <Streamdown
                            className="sd-theme rounded-2xl rounded-bl-md p-3"
                            plugins={{ code }}
                            controls={false}
                            isAnimating={isLastAssistant && isStreaming}
                          >
                            {part.text}
                          </Streamdown>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-kumo-line bg-kumo-base">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="max-w-3xl mx-auto px-5 py-4"
        >
          <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
            <InputArea
              ref={textareaRef}
              value={input}
              onValueChange={setInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder="Paste a transaction or ask about an account..."
              disabled={!connected || isStreaming}
              rows={1}
              className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
            />
            {isStreaming ? (
              <Button
                type="button"
                variant="secondary"
                shape="square"
                aria-label="Stop generation"
                icon={<StopIcon size={18} />}
                onClick={stop}
                className="mb-0.5"
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                shape="square"
                aria-label="Send message"
                disabled={!input.trim() || !connected}
                icon={<PaperPlaneRightIcon size={18} />}
                className="mb-0.5"
              />
            )}
          </div>
        </form>
        <div className="flex justify-center pb-3">
          <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Loading...
        </div>
      }
    >
      <Chat />
    </Suspense>
  );
}
