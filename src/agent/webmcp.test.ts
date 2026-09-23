import { afterEach, describe, expect, it, vi } from 'vitest';
import { findModelContext, registerAgentTools, type VoltopiaAgentApi } from './webmcp.ts';
import type { AgentTool } from './tools.ts';

interface FakeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  execute(
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

function fakeModelContext(): {
  context: { registerTool: (tool: FakeTool, options?: { signal?: AbortSignal }) => Promise<void> };
  registered: Map<string, FakeTool>;
} {
  const registered = new Map<string, FakeTool>();
  return {
    registered,
    context: {
      async registerTool(tool, options) {
        if (registered.has(tool.name)) throw new Error('InvalidStateError: exists');
        registered.set(tool.name, tool);
        options?.signal?.addEventListener('abort', () => registered.delete(tool.name));
      },
    },
  };
}

const echoTool: AgentTool = {
  name: 'echo',
  description: 'Echoes its input back for the test.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  async execute(input) {
    return { ok: true, text: input.text };
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerAgentTools', () => {
  it('registers with document.modelContext, wraps results MCP-style and unregisters on cleanup', async () => {
    const fake = fakeModelContext();
    vi.stubGlobal('document', { modelContext: fake.context });
    vi.stubGlobal('navigator', {});
    const host: { voltopia?: VoltopiaAgentApi } = {};
    vi.stubGlobal('window', host);

    expect(findModelContext()).toBe(fake.context);
    const unregister = registerAgentTools([echoTool]);
    await Promise.resolve();
    expect([...fake.registered.keys()]).toEqual(['echo']);
    const registered = fake.registered.get('echo')!;
    expect(registered.description).toBe(echoTool.description);
    expect(registered.annotations).toEqual({ readOnlyHint: true });
    const result = await registered.execute({ text: 'hi' });
    expect(result).toEqual({ content: [{ type: 'text', text: '{"ok":true,"text":"hi"}' }] });

    // The same tools are reachable without WebMCP.
    expect(host.voltopia?.tools.map((t) => t.name)).toEqual(['echo']);
    expect(await host.voltopia?.call('echo', { text: 'yo' })).toEqual({ ok: true, text: 'yo' });
    expect(await host.voltopia?.call('nope')).toMatchObject({ ok: false, error: 'unknownTool' });

    unregister();
    expect(fake.registered.size).toBe(0);
    expect(host.voltopia).toBeUndefined();
  });

  it('falls back to the deprecated navigator.modelContext and its unregisterTool', async () => {
    const fake = fakeModelContext();
    const unregisterTool = vi.fn((name: string) => fake.registered.delete(name));
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', { modelContext: { ...fake.context, unregisterTool } });
    vi.stubGlobal('window', {});

    const unregister = registerAgentTools([echoTool]);
    await Promise.resolve();
    expect(fake.registered.has('echo')).toBe(true);
    unregister();
    expect(unregisterTool).toHaveBeenCalledWith('echo');
  });

  it('still installs window.voltopia when the browser has no WebMCP', () => {
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', {});
    const host: { voltopia?: VoltopiaAgentApi } = {};
    vi.stubGlobal('window', host);
    expect(findModelContext()).toBeNull();
    const unregister = registerAgentTools([echoTool]);
    expect(host.voltopia?.tools).toHaveLength(1);
    unregister();
    expect(host.voltopia).toBeUndefined();
  });

  it('logs instead of throwing when a registration is refused', async () => {
    const fake = fakeModelContext();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('document', { modelContext: fake.context });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
    const unregister = registerAgentTools([echoTool, { ...echoTool }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
    unregister();
    warn.mockRestore();
  });
});
