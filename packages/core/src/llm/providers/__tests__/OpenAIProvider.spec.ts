import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import {
  OpenAIProvider,
  normalizeOpenAICompatibleBaseUrl,
  resolveOpenAICompatibleHeaders,
} from '../OpenAIProvider.js';

describe('OpenAIProvider.stream', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequestBody = '';
  let lastRequestHeaders: IncomingMessage['headers'] = {};

  beforeEach(async () => {
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== '/chat/completions' || req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      lastRequestBody = Buffer.concat(chunks).toString('utf8');
      lastRequestHeaders = req.headers;

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const frames = [
        'data: {"choices":[{"index":0,"delta":{"reasoning_content":"Need a tool. "}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"Hello "}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"world"}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"mcp_playwright_browser_snapshot","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"risk"}}]}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":" agent\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":6}}\n\n',
        'data: [DONE]\n\n',
      ];

      for (const frame of frames) {
        res.write(frame);
      }
      res.end();
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close');
  });

  it('normalizes bare OpenRouter base urls to the chat API root', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai')).toBe('https://openrouter.ai/api/v1');
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/')).toBe('https://openrouter.ai/api/v1');
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1');
  });

  it('adds default OpenRouter headers unless callers override them', () => {
    expect(resolveOpenAICompatibleHeaders('https://openrouter.ai/api/v1')).toEqual({
      'HTTP-Referer': 'https://risk-agent.local',
      'X-Title': 'risk-agent',
    });

    expect(resolveOpenAICompatibleHeaders('https://openrouter.ai/api/v1', {
      'HTTP-Referer': 'https://custom.example',
      'X-Title': 'custom-app',
    })).toEqual({
      'HTTP-Referer': 'https://custom.example',
      'X-Title': 'custom-app',
    });
  });

  it('streams text deltas and reconstructs tool calls from OpenAI-compatible SSE', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseUrl,
    });

    const chunks = [] as Array<any>;
    for await (const chunk of provider.stream!({
      model: 'qwen-plus',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'Find the risk rules.', timestamp: Date.now() }],
      tools: [{
        name: 'mcp.playwright.browser_snapshot',
        description: 'Search the docs',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      }],
      temperature: 0.6,
      maxTokens: 2048,
      topP: 0.85,
      presencePenalty: 0.2,
      frequencyPenalty: 0.1,
    } as any)) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'text_delta').map((chunk) => chunk.text).join('')).toBe('Hello world');

    expect(chunks.filter((chunk) => chunk.type === 'thinking_delta').map((chunk) => chunk.text).join('')).toBe('Need a tool. ');

    const toolChunk = chunks.find(
      (chunk) => chunk.type === 'content_block_stop' && chunk.blockType === 'tool_use',
    );
    expect(toolChunk?.toolBlock).toEqual({
      toolUseId: 'call_1',
      name: 'mcp.playwright.browser_snapshot',
      input: { query: 'risk agent' },
    });

    const stopChunk = chunks.findLast((chunk) => chunk.type === 'message_stop');
    expect(stopChunk?.stopReason).toBe('tool_use');
    expect(stopChunk?.usage.inputTokens).toBe(12);
    expect(stopChunk?.usage.outputTokens).toBe(6);

    const requestBody = JSON.parse(lastRequestBody);
    expect(requestBody.stream).toBe(true);
    expect(requestBody.stream_options).toEqual({ include_usage: true });
    expect(requestBody.tools?.[0]?.function?.name).toBe('mcp_playwright_browser_snapshot');
    expect(requestBody.temperature).toBe(0.6);
    expect(requestBody.max_tokens).toBe(2048);
    expect(requestBody.top_p).toBe(0.85);
    expect(requestBody.presence_penalty).toBe(0.2);
    expect(requestBody.frequency_penalty).toBe(0.1);
  });

  it('maps sanitized OpenAI-compatible tool names back to the original dotted name in non-stream calls', async () => {
    server.removeAllListeners('request');
    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== '/chat/completions' || req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      lastRequestBody = Buffer.concat(chunks).toString('utf8');

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: {
                name: 'mcp_playwright_browser_take_screenshot',
                arguments: JSON.stringify({ fullPage: true }),
              },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
        },
      }));
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseUrl,
    });

    const result = await provider.call({
      model: 'qwen-plus',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'Take a screenshot.', timestamp: Date.now() }],
      tools: [{
        name: 'mcp.playwright.browser_take_screenshot',
        description: 'Take a browser screenshot',
        inputSchema: {
          type: 'object',
          properties: {
            fullPage: { type: 'boolean' },
          },
        },
      }],
    } as any);

    expect(result.toolCalls).toEqual([{
      toolUseId: 'call_2',
      name: 'mcp.playwright.browser_take_screenshot',
      input: { fullPage: true },
    }]);

    const requestBody = JSON.parse(lastRequestBody);
    expect(requestBody.tools?.[0]?.function?.name).toBe('mcp_playwright_browser_take_screenshot');
  });

  it('sends caller-provided extra headers on requests', async () => {
    server.removeAllListeners('request');
    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== '/chat/completions' || req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      for await (const _chunk of req) {
        // consume request body
      }
      lastRequestHeaders = req.headers;

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'pong', tool_calls: [] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      }));
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseUrl,
      extraHeaders: {
        'HTTP-Referer': 'https://risk-agent.local',
        'X-Title': 'risk-agent',
      },
    });

    const result = await provider.call({
      model: 'qwen-plus',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'Reply with pong.', timestamp: Date.now() }],
      tools: [],
    } as any);

    expect(result.text).toBe('pong');
    expect(lastRequestHeaders['http-referer']).toBe('https://risk-agent.local');
    expect(lastRequestHeaders['x-title']).toBe('risk-agent');
  });

  it('skips image_url follow-up messages for DeepSeek endpoints that only accept text content', async () => {
    server.removeAllListeners('request');
    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      lastRequestBody = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Done.', tool_calls: [] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }));
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key', baseUrl });

    await provider.call({
      model: 'deepseek-v4-pro',
      systemPrompt: 'You are helpful.',
      messages: [
        { role: 'user', content: 'Describe the screenshot.', timestamp: 0 },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ toolUseId: 'call_1', name: 'mcp.playwright.browser_take_screenshot', input: { type: 'png' } }],
          timestamp: 0,
        },
        {
          role: 'tool',
          content: '',
          toolResults: [{
            toolUseId: 'call_1',
            isError: false,
            content: {
              content: [
                { type: 'text', text: 'Screenshot captured.' },
                { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
              ],
            },
          }],
          timestamp: 0,
        },
      ],
      tools: [{
        name: 'mcp.playwright.browser_take_screenshot',
        description: 'Take a screenshot',
        inputSchema: { type: 'object', properties: { type: { type: 'string' } } },
      }],
    } as any);

    const body = JSON.parse(lastRequestBody);
    const msgs = body.messages as any[];
    expect(msgs.some((msg) => msg.role === 'user' && Array.isArray(msg.content))).toBe(false);
    expect(msgs.some((msg) => msg.role === 'tool' && msg.content === 'Screenshot captured.')).toBe(true);
  });

  it('parses CRLF-delimited SSE frames from compatible providers', async () => {
    server.removeAllListeners('request');
    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== '/chat/completions' || req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      for await (const _chunk of req) {
        // consume request body
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const frames = [
        'data: {"choices":[{"index":0,"delta":{"content":"你"}}]}\r\n\r\n',
        'data: {"choices":[{"index":0,"delta":{"content":"好"}}]}\r\n\r\n',
        'data: {"choices":[{"index":0,"delta":{"content":"！"},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":3}}\r\n\r\n',
        'data: [DONE]\r\n\r\n',
      ];

      for (const frame of frames) {
        res.write(frame);
      }
      res.end();
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseUrl,
    });

    const chunks = [] as Array<any>;
    for await (const chunk of provider.stream!({
      model: 'qwen3-coder-plus',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'Say hello in Chinese.', timestamp: Date.now() }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.filter((chunk) => chunk.type === 'text_delta').map((chunk) => chunk.text).join('')).toBe('你好！');

    const stopChunk = chunks.findLast((chunk) => chunk.type === 'message_stop');
    expect(stopChunk?.usage.inputTokens).toBe(8);
    expect(stopChunk?.usage.outputTokens).toBe(3);
  });

  it('finishes the stream when the provider sends [DONE] before closing the socket', async () => {
    server.removeAllListeners('request');
    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== '/chat/completions' || req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      for await (const _chunk of req) {
        // consume request body
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      res.write('data: {"choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n');
      res.write('data: [DONE]\n\n');

      await once(req, 'close');
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseUrl,
    });

    const completion = (async () => {
      const chunks = [] as Array<any>;
      for await (const chunk of provider.stream!({
        model: 'deepseek-v4-pro',
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'Finish after DONE.', timestamp: Date.now() }],
      })) {
        chunks.push(chunk);
      }
      return chunks;
    })();

    const chunks = await Promise.race([
      completion,
      new Promise<Array<any>>((_, reject) => {
        setTimeout(() => reject(new Error('stream did not finish after [DONE]')), 500);
      }),
    ]);

    expect(chunks.filter((chunk) => chunk.type === 'text_delta').map((chunk) => chunk.text).join('')).toBe('done');
    const stopChunk = chunks.findLast((chunk) => chunk.type === 'message_stop');
    expect(stopChunk?.stopReason).toBe('end_turn');
    expect(stopChunk?.usage.inputTokens).toBe(5);
    expect(stopChunk?.usage.outputTokens).toBe(1);
  });

  it('throws when the compatible endpoint returns a non-2xx error payload', async () => {
    server.removeAllListeners('request');
    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== '/chat/completions' || req.method !== 'POST') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      for await (const _chunk of req) {
        // consume request body
      }

      res.writeHead(400, {
        'content-type': 'application/json',
      });
      res.end(JSON.stringify({
        error: {
          message: 'model `qwen-plus` is not supported.',
          type: 'invalid_request_error',
        },
      }));
    });

    const provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseUrl,
    });

    const consume = async () => {
      const chunks = [] as Array<any>;
      for await (const chunk of provider.stream!({
        model: 'qwen-plus',
        systemPrompt: 'You are helpful.',
        messages: [{ role: 'user', content: 'Find the risk rules.', timestamp: Date.now() }],
      })) {
        chunks.push(chunk);
      }
      return chunks;
    };

    await expect(consume()).rejects.toThrow('model `qwen-plus` is not supported.');
  });

  it('formats multi-turn tool messages with tool_call_id and assistant tool_calls', async () => {
    server.removeAllListeners('request');
    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      lastRequestBody = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Done.', tool_calls: [] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }));
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key', baseUrl });

    await provider.call({
      model: 'qwen-plus',
      systemPrompt: 'You are helpful.',
      messages: [
        { role: 'user', content: 'Take a screenshot.', timestamp: 0 },
        {
          role: 'assistant',
          content: '',
          reasoningContent: 'Need a screenshot first.',
          toolCalls: [{ toolUseId: 'call_1', name: 'mcp.playwright.browser_take_screenshot', input: { fullPage: true } }],
          timestamp: 0,
        },
        {
          role: 'tool',
          content: '',
          toolResults: [{
            toolUseId: 'call_1',
            isError: false,
            content: {
              content: [
                { type: 'text', text: 'Screenshot captured.' },
                { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
              ],
            },
          }],
          timestamp: 0,
        },
      ],
      tools: [{
        name: 'mcp.playwright.browser_take_screenshot',
        description: 'Take a screenshot',
        inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean' } } },
      }],
    } as any);

    const body = JSON.parse(lastRequestBody);
    const msgs = body.messages as any[];

    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: 'Take a screenshot.' });

    // assistant message must include tool_calls array
    const assistantMsg = msgs[2];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.reasoning_content).toBe('Need a screenshot first.');
    expect(Array.isArray(assistantMsg.tool_calls)).toBe(true);
    expect(assistantMsg.tool_calls[0].id).toBe('call_1');
    expect(assistantMsg.tool_calls[0].type).toBe('function');
    expect(assistantMsg.tool_calls[0].function.name).toBe('mcp_playwright_browser_take_screenshot');

    // tool result message must include tool_call_id
    const toolMsg = msgs[3];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('call_1');
    expect(toolMsg.content).toBe('Screenshot captured.');

    // image extracted as subsequent user vision message
    const imageMsg = msgs[4];
    expect(imageMsg.role).toBe('user');
    expect(Array.isArray(imageMsg.content)).toBe(true);
    expect(imageMsg.content[0].type).toBe('image_url');
    expect(imageMsg.content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
  });
});
