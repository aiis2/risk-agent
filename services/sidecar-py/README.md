# Risk Agent Python Sidecar

可选的 Python 边车服务，承担：

- `POST /embed` — 文本嵌入（默认 BGE-M3）
- `POST /curate` — 对话/技能策展（调用 Node 侧配置的 LLM endpoint）
- `GET  /healthz` — 探活

> Sidecar 不可用时，Node 端会自动降级（关键词匹配 + 跳过策展），系统照常运行。

## 启动

```bash
cd services/sidecar-py
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -e .
uvicorn app.main:app --host 127.0.0.1 --port 7531
```

或使用 uv：

```bash
uv venv .venv
uv pip install -e .
uv run uvicorn app.main:app --host 127.0.0.1 --port 7531
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `EMBED_MODEL` | `BAAI/bge-m3` | sentence-transformers 模型 ID |
| `EMBED_MODEL_PATH` | （空） | 已下载本地权重路径，优先于 EMBED_MODEL |
| `LLM_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible LLM 端点 |
| `LLM_API_KEY` | `dummy` | LLM API key |
| `LLM_MODEL` | `qwen2.5:7b-instruct` | LLM 模型名 |
| `SIDECAR_PORT` | `7531` | 监听端口（loopback） |

## 与 Node 端对接

Node 通过 [`packages/server/src/services/SidecarClient.ts`](../../packages/server/src/services/SidecarClient.ts) 调用本服务。
所有调用都带超时 + 静默降级。
