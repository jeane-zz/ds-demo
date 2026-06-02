# LLM Provider 架构方案

> 关键词：本地优先 · 优雅降级 · 无状态抽象 · 统一错误体系

---

## 1. 问题与目标

项目需要支持**本地 LLM（Ollama）**和**云端 LLM（DeepSeek）**两种模型来源，且希望在本地服务不可用时**自动、平滑地**切换到云端。目标：

1. 调用方无需关心当前使用哪个 Provider
2. 主 Provider 失败时自动 Fallback，前端感知不到切换过程
3. 错误信息统一，便于调试和用户反馈
4. 支持未来扩展更多 Provider

## 2. 技术方案

### 2.1 双层 Provider 配置

通过环境变量驱动配置，所有 Provider 信息集中在 `config.ts` 中：

```typescript
// app/lib/llm/config.ts

export interface LlmConfig {
  primary: LlmProviderConfig;   // Ollama（本地）
  fallback: LlmProviderConfig;  // DeepSeek（云端）
}

export function getLlmConfig(env: Env = process.env): LlmConfig {
  return {
    primary: {
      name: "ollama",
      baseURL: readEnv(env, "OLLAMA_BASE_URL", "http://localhost:11434/v1"),
      model: readEnv(env, "OLLAMA_MODEL", "qwen2.5-coder:7b"),
      apiKey: "ollama", // OpenAI SDK 要求 apiKey 不为空
    },
    fallback: {
      name: "deepseek",
      baseURL: readEnv(env, "DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
      model: readEnv(env, "DEEPSEEK_MODEL", "deepseek-chat"),
      apiKey: readOptionalEnv(env, "DEEPSEEK_API_KEY"), // 不配置时 fallback 不可用
    },
  };
}
```

**设计要点**：
- `readEnv()` 有默认值，本地开发零配置可用
- `readOptionalEnv()` 允许 API Key 为空，用于判断 fallback 是否可用
- `getLlmConfig()` 接受自定义 env 对象，方便测试时注入 mock 环境变量

### 2.2 统一调用链路

所有 LLM 调用都经过 `runWithLlmFallback`：

```typescript
// app/lib/llm/provider.ts

export async function runWithLlmFallback<T>(
  operation: (provider: LlmProviderConfig) => Promise<T>,
  options: RunWithFallbackOptions
): Promise<T> {
  const config = options.config ?? getLlmConfig();

  // 1. 优先尝试 Primary（Ollama）
  try {
    return await operation(config.primary);
  } catch (primaryError) {
    // 日志警告，不阻断流程
    logger.warn(`Primary failed: ${summarizeError(primaryError)}`);
  }

  // 2. 无 fallback 配置时抛特定错误
  if (!config.fallback.apiKey) {
    throw new MissingFallbackProviderError();
  }

  // 3. 尝试 Fallback（DeepSeek）
  try {
    return await operation(config.fallback);
  } catch (fallbackError) {
    logger.error(`Fallback also failed: ${summarizeError(fallbackError)}`);
    throw new ProviderCallError(options.operationName, config.fallback.name);
  }
}
```

**关键设计**：
- **无状态抽象**：`operation` 是一个 `(provider) => Promise<T>` 函数，不关心具体调用逻辑，聊天流式、压缩、标题生成等全部复用此函数
- **先日志后抛错**：Primary 失败只 warn 不 throw，让开发者能在日志中看到但不影响用户

### 2.3 错误体系

三层错误类型：

| 错误类 | HTTP 状态码 | 触发条件 |
|--------|-------------|----------|
| `MissingFallbackProviderError` | 503 | Ollama 不可用且未配置 DeepSeek Key |
| `ProviderCallError` | 503 | 两个 Provider 都失败 |
| 其他未知错误 | 500 | 非 LLM 调用的系统错误 |

统一错误响应函数 `toLlmErrorResponse()` 将错误映射为 JSON Response。

### 2.4 各 API 的复用情况

| API 路由 | operation 内容 | Fallback 支持 |
|----------|---------------|:---:|
| `/api/chat` | `client.chat.completions.create({ stream: true })` | ✅ |
| `/api/chat` (tool decision) | `client.chat.completions.create({ stream: false, tools })` | ✅ |
| `/api/compress` | `client.chat.completions.create({ stream: false })` | ✅ |
| `/api/title` | `client.chat.completions.create({ stream: false })` | ✅ |

**例外**：`/api/documents/extract` 使用 `@ai-sdk/openai` v3 通过 `generateText` 调用 DeepSeek，未经过 `runWithLlmFallback`，这是已知的技术债务。

## 3. 调用示例（聊天 API）

```typescript
// app/api/chat/route.ts

const completion = await runWithLlmFallback(
  (provider) =>
    createOpenAIClient(provider).chat.completions.create({
      model: provider.model,
      messages,
      stream: true,
    }),
  { operationName: "chat stream" }
);
```

## 4. 边界情况

| 场景 | 行为 |
|------|------|
| Ollama 未安装/未启动 | 自动 fallback DeepSeek（如已配置 Key） |
| DeepSeek 也未配置 | 返回 503 + 清晰提示"请启动 Ollama 或配置 DEEPSEEK_API_KEY" |
| Ollama 正常但请求超时 | fallback 到 DeepSeek |
| 所有 Provider 都失败 | 返回 503 + "所有 AI Provider 均不可用" |
| 网络断开 | Ollama（本地）仍可用，不受影响 |