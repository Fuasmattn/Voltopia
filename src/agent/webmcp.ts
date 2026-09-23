/**
 * Exposes the agent tools to machines:
 *
 * - WebMCP: `document.modelContext.registerTool(...)` (current draft;
 *   Chrome ≥ 146 early preview) with `navigator.modelContext` as the
 *   deprecated fallback. Results are returned MCP-style as
 *   `{ content: [{ type: 'text', text: <JSON> }] }`, which both Chrome's
 *   implementation and the `@mcp-b/global` polyfill accept.
 * - `window.voltopia`: the same tools for scripted agents (Playwright,
 *   DevTools MCP) in browsers without WebMCP. `call(name, input)` resolves
 *   to the plain JSON result.
 */
import { callTool, type AgentTool } from './tools.ts';

interface ModelContextLike {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: Record<string, boolean>;
      execute(
        input: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ): Promise<{ content: Array<{ type: 'text'; text: string }> }>;
    },
    options?: { signal?: AbortSignal },
  ): unknown;
  unregisterTool?(name: string): unknown;
}

export interface VoltopiaAgentApi {
  /** Tool descriptors (name, description, input schema, annotations). */
  tools: Array<Pick<AgentTool, 'name' | 'description' | 'inputSchema' | 'annotations'>>;
  /** Run a tool; resolves to its JSON result (never throws on bad input). */
  call(name: string, input?: unknown): Promise<unknown>;
}

/** The browser's WebMCP entry point, if any. */
export function findModelContext(): ModelContextLike | null {
  const doc = document as unknown as { modelContext?: ModelContextLike };
  if (doc.modelContext?.registerTool) return doc.modelContext;
  const nav = navigator as unknown as { modelContext?: ModelContextLike };
  if (nav.modelContext?.registerTool) return nav.modelContext;
  return null;
}

/**
 * Register the tools with WebMCP (when available) and on `window.voltopia`.
 * Returns a function that removes both again.
 */
export function registerAgentTools(tools: AgentTool[]): () => void {
  const api: VoltopiaAgentApi = {
    tools: tools.map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      ...(annotations ? { annotations } : {}),
    })),
    call: (name, input) => callTool(tools, name, input),
  };
  const host = window as unknown as { voltopia?: VoltopiaAgentApi };
  host.voltopia = api;

  const context = findModelContext();
  const controller = new AbortController();
  if (context) {
    for (const tool of tools) {
      try {
        const registration = context.registerTool(
          {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
            execute: async (input, options) => {
              const result = await callTool(
                tools,
                tool.name,
                input,
                options?.signal ? { signal: options.signal } : undefined,
              );
              return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            },
          },
          { signal: controller.signal },
        );
        // The current draft returns a promise; older builds return nothing.
        // An AbortError only means we unregistered before the browser
        // settled (React StrictMode mounts twice in dev) — not a failure.
        void Promise.resolve(registration).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          console.warn(`WebMCP: could not register ${tool.name}`, error);
        });
      } catch (error) {
        console.warn(`WebMCP: could not register ${tool.name}`, error);
      }
    }
  }

  return () => {
    controller.abort();
    if (context?.unregisterTool) {
      for (const tool of tools) {
        try {
          context.unregisterTool(tool.name);
        } catch {
          // already gone (aborted) — fine
        }
      }
    }
    if (host.voltopia === api) delete host.voltopia;
  };
}
