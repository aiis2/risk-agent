/**
 * seed-sse-test.mjs — SSE 输出功能验证脚本
 *
 * 使用方式:
 *   node test/seed-sse-test.mjs
 *
 * 环境变量 (可写入 .env 或 risk_agent_data/.env):
 *   TEST_MODEL_BASE_URL  — OpenAI 兼容 API Base URL
 *   TEST_MODEL_API_KEY   — API Key
 *   TEST_MODEL_NAME      — 模型名称 (默认 qwen3-coder-plus)
 *   API_BASE_URL         — Risk Agent 服务地址 (默认 http://127.0.0.1:8787/api)
 *
 * 测试内容:
 *   1. 通过 /api/models 创建 OpenAI 兼容模型配置
 *   2. 调用 /api/models/:id/test?mode=stream 验证 SSE 流式输出
 *   3. 验证 Markdown 输出格式 (标题、列表、代码块)
 *   4. 清理测试数据 (可选, 设置 KEEP_TEST_MODEL=1 跳过删除)
 */

const API_BASE = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787/api';
const BASE_URL = process.env.TEST_MODEL_BASE_URL ?? 'https://coding.dashscope.aliyuncs.com/v1';
const API_KEY  = process.env.TEST_MODEL_API_KEY ?? '';
const MODEL    = process.env.TEST_MODEL_NAME ?? 'qwen3-coder-plus';

const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';

function log(tag, msg, color = RESET) {
  console.log(`${color}[${tag}]${RESET} ${msg}`);
}

if (!API_KEY) {
  log('WARN', '未设置 TEST_MODEL_API_KEY, 将跳过实际 SSE 测试 (仅验证配置写入)', YELLOW);
}

// ── 测试用例 ──────────────────────────────────────────────────────────────────

const TEST_PROMPTS = [
  {
    name: 'markdown-headings',
    prompt: '请用中文输出一段包含 # H1、## H2、### H3 标题的 Markdown 风险报告摘要，不超过100字。',
    validate: (text) => text.includes('#') && text.length > 20,
  },
  {
    name: 'markdown-list',
    prompt: '请用中文用无序列表列出3个支付风控要点，每点不超过20字。格式如：\n- 要点1\n- 要点2\n- 要点3',
    validate: (text) => text.includes('-') || text.includes('•'),
  },
  {
    name: 'markdown-code-block',
    prompt: '请用中文输出一段风险摘要，并附带一个 json 代码块，内容示例：{"score": 85, "level": "high"}。',
    validate: (text) => text.includes('```') || text.includes('json'),
  },
  {
    name: 'markdown-table',
    prompt: '请用 Markdown 表格列出3种常见支付欺诈类型及其风险等级，中文输出。',
    validate: (text) => text.includes('|'),
  },
  {
    name: 'inline-code',
    prompt: '请用中文说明什么是 `risk_score`，并解释其计算方式，不超过80字。',
    validate: (text) => text.length > 20,
  },
];

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('START', `SSE 输出功能验证脚本`, CYAN);
  log('INFO', `API 地址: ${API_BASE}`);
  log('INFO', `模型 BaseURL: ${BASE_URL}`);
  log('INFO', `模型名称: ${MODEL}`);

  // ── Step 1: 创建模型配置 ────────────────────────────────────────────────────
  log('STEP', '1. 创建 OpenAI 兼容模型配置…', CYAN);

  let modelId;
  try {
    // Check if test model already exists
    const models = await apiGet('/models');
    const existing = models.find(
      (m) => m.modelName === MODEL && m.provider === 'openai-compatible'
        && m.config?.baseUrl === BASE_URL
    );
    if (existing) {
      modelId = existing.modelId;
      log('INFO', `已有测试模型配置: ${modelId}`, YELLOW);
    } else {
      const created = await apiPost('/models', {
        provider: 'openai-compatible',
        modelName: MODEL,  // use actual model name for API calls
        role: 'primary',
        config: {
          baseUrl: BASE_URL,
          apiKey: API_KEY || 'placeholder-key',
          temperature: 0.3,
          maxTokens: 2048,
        },
      });
      modelId = created.modelId;
      log('OK', `创建模型配置成功: modelId=${modelId}`, GREEN);
    }
  } catch (err) {
    log('ERROR', `创建模型配置失败: ${err.message}`, RED);
    process.exit(1);
  }

  if (!API_KEY) {
    log('SKIP', '未提供 API Key, 跳过 SSE 流式测试', YELLOW);
    log('INFO', `如需测试, 请设置: TEST_MODEL_API_KEY=<your-key> node test/seed-sse-test.mjs`);
    await cleanup(modelId);
    return;
  }

  // ── Step 2: 运行 SSE 流式测试 ────────────────────────────────────────────────
  log('STEP', '2. 运行 SSE 流式输出测试…', CYAN);

  const results = [];

  for (const tc of TEST_PROMPTS) {
    process.stdout.write(`  [TEST] ${tc.name}… `);
    try {
      const result = await apiPost(`/models/${modelId}/test`, {
        prompt: tc.prompt,
        mode: 'stream',
      });

      if (!result.success) {
        console.log(`${RED}FAIL${RESET} (success=false)`);
        results.push({ name: tc.name, pass: false, error: result.error ?? 'success=false' });
        continue;
      }

      const text = result.text ?? '';
      const isValid = tc.validate(text);

      if (!isValid) {
        console.log(`${YELLOW}WARN${RESET} (格式检查未通过, 但 API 返回成功)`);
        log('OUTPUT', text.slice(0, 200));
        results.push({ name: tc.name, pass: false, error: 'validation failed', text });
      } else {
        console.log(`${GREEN}PASS${RESET} (${result.chunkCount ?? '?'} chunks, ${result.durationMs}ms)`);
        results.push({ name: tc.name, pass: true, text });
      }
    } catch (err) {
      console.log(`${RED}ERROR${RESET}`);
      results.push({ name: tc.name, pass: false, error: err.message });
    }
  }

  // ── Step 3: 汇总报告 ─────────────────────────────────────────────────────────
  log('STEP', '3. 测试汇总', CYAN);
  const passed = results.filter((r) => r.pass).length;
  const total  = results.length;

  for (const r of results) {
    const icon = r.pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
  }
  console.log();
  if (passed === total) {
    log('PASS', `全部 ${total} 项测试通过`, GREEN);
  } else {
    log('FAIL', `${passed}/${total} 项通过`, RED);
  }

  // ── Step 4: 清理 ────────────────────────────────────────────────────────────
  await cleanup(modelId);

  process.exit(passed === total ? 0 : 1);
}

async function cleanup(modelId) {
  if (process.env.KEEP_TEST_MODEL === '1') {
    log('INFO', `已跳过清理 (KEEP_TEST_MODEL=1), 模型配置保留: ${modelId}`);
    return;
  }
  try {
    await apiDelete(`/models/${modelId}`);
    log('CLEANUP', `已删除测试模型配置: ${modelId}`);
  } catch {
    log('WARN', `清理失败, 请手动删除模型: ${modelId}`, YELLOW);
  }
}

main().catch((err) => {
  log('FATAL', err.message, RED);
  console.error(err);
  process.exit(1);
});
