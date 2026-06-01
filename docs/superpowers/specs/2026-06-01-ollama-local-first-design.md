# Ollama 本地优先 LLM 集成设计

## 目标

将 Ollama 集成为所有 AI 功能的默认本地模型提供方，并在本地服务不可用时保留 DeepSeek 作为可选 fallback。

## 范围

本设计覆盖以下已有 AI 调用点：

- 主对话流式 API：`app/api/chat/route.ts`
- 会话标题生成：`app/api/title/route.ts`
- 对话上下文压缩：`app/api/compress/route.ts`
- 开发问题文档提取：`app/api/documents/extract/route.ts`

本次实现不新增前端 provider 选择器。模型提供方选择只在服务端通过配置和 fallback 规则完成。

## 已确认决策

- 默认调用顺序：先 Ollama，后 DeepSeek fallback。
- 默认 Ollama 模型：`qwen2.5-coder:7b`。
- 所有 AI 功能都使用同一套本地优先行为。
- DeepSeek 只在配置了 `DEEPSEEK_API_KEY` 时作为 fallback 可用。
- `http://localhost:11434/v1` 是 API base URL，不是浏览器页面。

## 架构

在 `app/lib/llm` 下新增一个小型 LLM provider 层。现有 API 路由不再直接创建 provider client，而是调用这一层提供的能力。

Provider 层负责：

- 读取模型和 base URL 配置。
- 为 Ollama 和 DeepSeek 创建 OpenAI-compatible client。
- 按顺序先尝试 Ollama，再尝试 DeepSeek。
- 返回明确的 provider 或配置错误。
- 让 route 代码继续聚焦在请求校验和响应组织上。

主对话 route 应继续沿用 `app/api/chat/route.ts` 中现有的 OpenAI SDK 风格，因为该 route 依赖 OpenAI-compatible streaming 和 tool calling。Ollama 的 OpenAI-compatible `/v1` endpoint 应尽量复用同一套请求结构。

文档提取 route 当前使用 Vercel AI SDK。实现时可以调用基于同一 provider 配置的 helper，也可以重构为共享的 OpenAI-compatible provider helper。最终选择应以改动更小、provider 选择逻辑仍集中为准。

## 配置

支持的环境变量：

- `OLLAMA_BASE_URL`：可选，默认 `http://localhost:11434/v1`
- `OLLAMA_MODEL`：可选，默认 `qwen2.5-coder:7b`
- `DEEPSEEK_API_KEY`：启动时可选，仅 fallback 时必需
- `DEEPSEEK_BASE_URL`：可选，默认 `https://api.deepseek.com`
- `DEEPSEEK_MODEL`：可选，默认 `deepseek-chat`

当前缺少 `DEEPSEEK_API_KEY` 时的启动警告需要调整。因为默认路径是 Ollama，本地优先使用时不应该让缺少 DeepSeek 凭证看起来像配置错误。只有需要 fallback 时，缺少 key 才是问题。

## 运行行为

每一次 AI 操作都按以下流程执行：

1. 使用配置的本地模型调用 Ollama。
2. 如果 Ollama 成功，直接返回 Ollama 结果。
3. 如果 Ollama 因服务不可达、模型缺失或 API 返回错误而失败，服务端记录一条简短警告日志。
4. 如果存在 `DEEPSEEK_API_KEY`，使用 DeepSeek 重试同一操作。
5. 如果 fallback 未配置，返回 503，并同时说明：
   - Ollama 本地服务不可用。
   - DeepSeek fallback 未配置。

503 响应应引导用户运行：

```bash
ollama serve
ollama pull qwen2.5-coder:7b
```

或配置：

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
```

主对话的 tool calling 流程也使用同样的 provider 顺序。实现不需要在前端展示本次请求实际使用了哪个 provider。

## 错误处理

引入明确的 provider 错误，避免 route 直接泄漏原始 SDK 错误：

- 本地 provider 不可用。
- fallback provider 缺少配置。
- 所有 provider 都调用失败。

非流式 route 应继续返回带有合适 HTTP 状态码的 JSON 错误。流式 chat route 在请求无法开始时，应保持当前用户可见行为风格。

服务端日志应包含哪个 provider 失败、是否尝试 fallback，但不能记录 API key 或完整 prompt。

## 文档

更新 `README.md`，让项目说明和启动说明体现：

- 默认模型路径是 Ollama 本地优先。
- DeepSeek 是可选 fallback，不再是默认必需项。
- 准备 Ollama：

```bash
ollama pull qwen2.5-coder:7b
ollama serve
```

- 验证 Ollama 是否运行：

```bash
curl http://localhost:11434/api/tags
curl http://localhost:11434/v1/models
```

- `http://localhost:11434/v1` 是 API base URL，直接用浏览器打开时可能不是可读页面。

## 测试

为 provider 层新增聚焦测试：

- 默认配置会解析为 Ollama：base URL 为 `http://localhost:11434/v1`，模型为 `qwen2.5-coder:7b`。
- 当 Ollama 失败且存在 `DEEPSEEK_API_KEY` 时，同一操作会重试 DeepSeek。
- 当 Ollama 失败且缺少 `DEEPSEEK_API_KEY` 时，provider 层会抛出明确的 fallback 配置错误。

除非实现明显改变 route 行为，否则不要求为 API route 新增大规模集成测试。主要验证命令是：

```bash
npm run lint
npm run build
```

## 非目标

- 不新增前端 provider 或 model 选择器。
- 不做按会话持久化 provider 设置。
- 不改变 RAG 和语义搜索使用的浏览器端 embedding 模型。
- 不替换现有 SQLite 或 IndexedDB 本地存储行为。

## 验收标准

- 所有 AI 调用点都先使用 Ollama。
- 配置 DeepSeek 后 fallback 可用。
- 缺少 DeepSeek 凭证不会阻塞正常的 Ollama 本地使用。
- 当 Ollama 不可用且 fallback 未配置时，用户能收到可执行的错误提示。
- README 准确记录本地优先的安装、启动和验证方式。
- `npm run lint` 和 `npm run build` 通过。
