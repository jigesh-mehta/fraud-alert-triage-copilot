/**
 * Workaround for workers-ai-provider 3.3.1 duplicating streamed tool-call
 * arguments with Llama 3.3.
 *
 * Each SSE chunk from the model carries its content in both the native
 * fields (top-level `response` / `tool_calls`) and the OpenAI-style
 * `choices[0].delta`; the provider handles both, so every text and tool
 * argument fragment is emitted twice (garbled text, malformed tool JSON).
 * This wraps the AI binding and drops the native copy when the delta copy
 * exists. It also drops an empty `tools` array, which Workers AI rejects.
 * Remove after upgrading the provider if the duplication is fixed.
 */

function dedupeLine(line: string): string {
  if (!line.startsWith("data:")) return line;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return line;
  try {
    const chunk = JSON.parse(payload);
    const delta = chunk?.choices?.[0]?.delta;
    if (delta) {
      let changed = false;
      if (Array.isArray(chunk.tool_calls) && Array.isArray(delta.tool_calls)) {
        delete chunk.tool_calls;
        changed = true;
      }
      if (
        typeof chunk.response === "string" &&
        typeof delta.content === "string"
      ) {
        delete chunk.response;
        changed = true;
      }
      if (changed) return `data: ${JSON.stringify(chunk)}`;
    }
  } catch {
    // Not JSON; pass through untouched.
  }
  return line;
}

function dedupeStream(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          controller.enqueue(encoder.encode(dedupeLine(line) + "\n"));
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) controller.enqueue(encoder.encode(dedupeLine(buffer)));
      }
    })
  );
}

export function patchWorkersAIBinding(ai: Ai): Ai {
  return new Proxy(ai, {
    get(target, prop) {
      if (prop !== "run") {
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        // Workers AI rejects `tools: []`; the AI SDK sends it when a step
        // disables all tools (activeTools: []).
        const inputs = args[1] as Record<string, unknown> | undefined;
        if (Array.isArray(inputs?.tools) && inputs.tools.length === 0) {
          const { tools: _t, tool_choice: _c, ...rest } = inputs;
          args[1] = rest;
        }
        const out = await (target.run as (...a: unknown[]) => Promise<unknown>)(
          ...args
        );
        return out instanceof ReadableStream ? dedupeStream(out) : out;
      };
    }
  });
}
