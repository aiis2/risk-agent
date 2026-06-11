import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../registry/ToolRegistry.js';
import { httpApiTool } from '../builtin/HttpApiTool.js';
import { askUserTool } from '../builtin/AskUserTool.js';
import { createJsSandboxTool } from '../builtin/JsSandboxTool.js';

describe('ToolRegistry', () => {
  it('partitions tools correctly', () => {
    const reg = new ToolRegistry();
    reg.register(httpApiTool);
    reg.register(askUserTool);
    const parts = reg.partition(['ask_user', 'http_api']);
    expect(parts.interrupt).toContain('ask_user');
    expect(parts.parallel).toContain('http_api');
  });

  it('exposes LLM specs', () => {
    const reg = new ToolRegistry();
    reg.register(httpApiTool);
    const specs = reg.toLLMToolSpecs();
    expect(specs[0].name).toBe('http_api');
  });

  it('preserves sandbox metadata on registered tools', () => {
    const reg = new ToolRegistry();
    const tool = createJsSandboxTool() as ReturnType<typeof createJsSandboxTool> & {
      sandboxProfile?: string;
      sandboxHostKind?: string;
    };

    reg.register(tool);

    const registered = reg.get('run_js_sandbox') as typeof tool;
    expect(registered.sandboxProfile).toBe('shared-js-runtime');
    expect(registered.sandboxHostKind).toBe('js-vm');
  });
});
