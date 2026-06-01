# Ollama Local-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有服务端 AI 调用先使用本地 Ollama `qwen2.5-coder:7b`，本地不可用时再按配置 fallback 到 DeepSeek。

**Architecture:** 新增 `app/lib/llm` 作为唯一 provider 选择层，API route 只负责校验请求、组织 prompt 和返回响应。Provider 层读取环境变量、创建 OpenAI-compatible client、执行 Ollama-first fallback，并把错误转换成 route 可复用的 503 响应。

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript strict mode, OpenAI Node SDK, Vitest, npm scripts.

---

## File Structure

- Create: `app/lib/llm/config.ts`  
  读取 `OLLAMA_*` 和 `DEEPSEEK_*` 环境变量，输出强类型 provider 配置。
- Create: `app/lib/llm/errors.ts`  
  定义 provider fallback 相关错误和用户可读的错误文案。
- Create: `app/lib/llm/provider.ts`  
  创建 OpenAI client，并提供 `runWithLlmFallback`。
- Create: `app/lib/llm/provider.test.ts`  
  覆盖默认配置、fallback 成功、fallback 缺 key 三个核心行为。
- Modify: `app/lib/env.ts`  
  移除启动时对 `DEEPSEEK_API_KEY` 的强提示，保留 `MissingEnvError` 和 `getRequiredEnv` 以兼容其它代码。
- Modify: `app/api/chat/route.ts`  
  主对话、工具调用决策、最终流式回答全部通过 provider 层。
- Modify: `app/api/title/route.ts`  
  标题生成通过 provider 层。
- Modify: `app/api/compress/route.ts`  
  上下文压缩通过 provider 层。
- Modify: `app/api/documents/extract/route.ts`  
  文档提取改为共享 OpenAI-compatible provider 层。
- Modify: `README.md`  
  更新为 Ollama 本地优先、DeepSeek fallback 的安装和验证说明。
- Modify: `package.json`, `package-lock.json`  
  增加 `vitest` 和 `npm test` 脚本。

## Task 1: Add Test Runner And Failing Provider Tests

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `app/lib/llm/provider.test.ts`

- [ ] **Step 1: Install Vitest**

Run:

```bash
npm install -D vitest
```

Expected: `package.json` and `package-lock.json` include `vitest` in `devDependencies`.

- [ ] **Step 2: Add test script**

Modify `package.json` scripts to include `test`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Write failing provider tests**

Create `app/lib/llm/provider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getLlmConfig } from "./config";
import { MissingFallbackProviderError, ProviderCallError } from "./errors";
import { runWithLlmFallback } from "./provider";

describe("getLlmConfig", () => {
  it("uses Ollama qwen2.5-coder:7b as the default primary provider", () => {
    const config = getLlmConfig({});

    expect(config.primary).toEqual({
      name: "ollama",
      baseURL: "http://localhost:11434/v1",
      model: "qwen2.5-coder:7b",
      apiKey: "ollama",
    });
    expect(config.fallback).toEqual({
      name: "deepseek",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: undefined,
    });
  });

  it("uses env overrides for Ollama and DeepSeek", () => {
    const config = getLlmConfig({
      OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
      OLLAMA_MODEL: "qwen2.5-coder:14b",
      DEEPSEEK_API_KEY: "deepseek-key",
      DEEPSEEK_BASE_URL: "https://example.test",
      DEEPSEEK_MODEL: "deepseek-reasoner",
    });

    expect(config.primary.baseURL).toBe("http://127.0.0.1:11434/v1");
    expect(config.primary.model).toBe("qwen2.5-coder:14b");
    expect(config.fallback.apiKey).toBe("deepseek-key");
    expect(config.fallback.baseURL).toBe("https://example.test");
    expect(config.fallback.model).toBe("deepseek-reasoner");
  });
});

describe("runWithLlmFallback", () => {
  it("retries DeepSeek when Ollama fails and fallback is configured", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ollama down"))
      .mockResolvedValueOnce("deepseek result");

    const result = await runWithLlmFallback(operation, {
      operationName: "unit test",
      config: getLlmConfig({ DEEPSEEK_API_KEY: "deepseek-key" }),
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(result).toBe("deepseek result");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation.mock.calls[0][0].name).toBe("ollama");
    expect(operation.mock.calls[1][0].name).toBe("deepseek");
  });

  it("throws a clear fallback config error when Ollama fails and DeepSeek key is missing", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("ollama down"));

    await expect(
      runWithLlmFallback(operation, {
        operationName: "unit test",
        config: getLlmConfig({}),
        logger: { warn: vi.fn(), error: vi.fn() },
      })
    ).rejects.toBeInstanceOf(MissingFallbackProviderError);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("wraps provider failures without exposing prompts or API keys", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("ollama prompt secret"))
      .mockRejectedValueOnce(new Error("deepseek key secret"));

    await expect(
      runWithLlmFallback(operation, {
        operationName: "unit test",
        config: getLlmConfig({ DEEPSEEK_API_KEY: "deepseek-key" }),
        logger: { warn: vi.fn(), error: vi.fn() },
      })
    ).rejects.toBeInstanceOf(ProviderCallError);
  });
});
```

- [ ] **Step 4: Run tests and verify they fail because modules do not exist**

Run:

```bash
npm test -- app/lib/llm/provider.test.ts
```

Expected: FAIL with import errors for `./config`, `./errors`, and `./provider`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app/lib/llm/provider.test.ts
git commit -m "test: cover llm provider fallback"
```

## Task 2: Implement LLM Provider Layer

**Files:**
- Create: `app/lib/llm/config.ts`
- Create: `app/lib/llm/errors.ts`
- Create: `app/lib/llm/provider.ts`
- Test: `app/lib/llm/provider.test.ts`

- [ ] **Step 1: Create config helper**

Create `app/lib/llm/config.ts`:

```ts
export type LlmProviderName = "ollama" | "deepseek";

export interface LlmProviderConfig {
  name: LlmProviderName;
  baseURL: string;
  model: string;
  apiKey?: string;
}

export interface LlmConfig {
  primary: LlmProviderConfig;
  fallback: LlmProviderConfig;
}

type Env = Partial<Record<string, string | undefined>>;

function readEnv(env: Env, key: string, fallback: string): string {
  const value = env[key];
  return value && value.trim() ? value.trim() : fallback;
}

function readOptionalEnv(env: Env, key: string): string | undefined {
  const value = env[key];
  return value && value.trim() ? value.trim() : undefined;
}

export function getLlmConfig(env: Env = process.env): LlmConfig {
  return {
    primary: {
      name: "ollama",
      baseURL: readEnv(env, "OLLAMA_BASE_URL", "http://localhost:11434/v1"),
      model: readEnv(env, "OLLAMA_MODEL", "qwen2.5-coder:7b"),
      apiKey: "ollama",
    },
    fallback: {
      name: "deepseek",
      baseURL: readEnv(env, "DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
      model: readEnv(env, "DEEPSEEK_MODEL", "deepseek-chat"),
      apiKey: readOptionalEnv(env, "DEEPSEEK_API_KEY"),
    },
  };
}
```

- [ ] **Step 2: Create provider errors**

Create `app/lib/llm/errors.ts`:

```ts
import type { LlmProviderName } from "./config";

export class MissingFallbackProviderError extends Error {
  constructor() {
    super(
      "Ollama local service is unavailable and DeepSeek fallback is not configured. Run `ollama serve`, pull `qwen2.5-coder:7b`, or set DEEPSEEK_API_KEY."
    );
    this.name = "MissingFallbackProviderError";
  }
}

export class ProviderCallError extends Error {
  constructor(
    public readonly operationName: string,
    public readonly providerName: LlmProviderName
  ) {
    super(`${operationName} failed for provider ${providerName}`);
    this.name = "ProviderCallError";
  }
}

export function toLlmErrorResponse(error: unknown): Response {
  if (error instanceof MissingFallbackProviderError) {
    return Response.json({ error: error.message }, { status: 503 });
  }

  if (error instanceof ProviderCallError) {
    return Response.json(
      { error: "All configured AI providers failed to process the request" },
      { status: 503 }
    );
  }

  return Response.json({ error: "Failed to process AI request" }, { status: 500 });
}
```

- [ ] **Step 3: Create provider runner**

Create `app/lib/llm/provider.ts`:

```ts
import OpenAI from "openai";
import { getLlmConfig, type LlmConfig, type LlmProviderConfig } from "./config";
import { MissingFallbackProviderError, ProviderCallError } from "./errors";

interface LlmLogger {
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface RunWithFallbackOptions {
  operationName: string;
  config?: LlmConfig;
  logger?: LlmLogger;
}

export function createOpenAIClient(provider: LlmProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: provider.apiKey ?? "missing",
    baseURL: provider.baseURL,
  });
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider error";
}

export async function runWithLlmFallback<T>(
  operation: (provider: LlmProviderConfig) => Promise<T>,
  options: RunWithFallbackOptions
): Promise<T> {
  const config = options.config ?? getLlmConfig();
  const logger = options.logger ?? console;

  try {
    return await operation(config.primary);
  } catch (primaryError) {
    logger.warn(
      `[llm] ${options.operationName} failed on ${config.primary.name}: ${summarizeError(
        primaryError
      )}. Trying fallback.`
    );
  }

  if (!config.fallback.apiKey) {
    throw new MissingFallbackProviderError();
  }

  try {
    return await operation(config.fallback);
  } catch (fallbackError) {
    logger.error(
      `[llm] ${options.operationName} failed on ${config.fallback.name}: ${summarizeError(
        fallbackError
      )}.`
    );
    throw new ProviderCallError(options.operationName, config.fallback.name);
  }
}
```

- [ ] **Step 4: Run provider tests**

Run:

```bash
npm test -- app/lib/llm/provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/lib/llm/config.ts app/lib/llm/errors.ts app/lib/llm/provider.ts app/lib/llm/provider.test.ts
git commit -m "feat: add llm provider fallback"
```

## Task 3: Relax DeepSeek Startup Env Warning

**Files:**
- Modify: `app/lib/env.ts`

- [ ] **Step 1: Replace `app/lib/env.ts`**

Replace the file with:

```ts
/**
 * 环境变量工具。
 *
 * Ollama 是默认本地模型路径，因此 DeepSeek 凭证只在 fallback 时由 LLM provider 层校验。
 */

export class MissingEnvError extends Error {
  constructor(public readonly key: string) {
    super(`Missing required environment variable: ${key}`);
    this.name = "MissingEnvError";
  }
}

export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new MissingEnvError(key);
  }
  return value;
}
```

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/lib/env.ts
git commit -m "chore: relax deepseek env startup warning"
```

## Task 4: Update Chat Route To Use Provider Fallback

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Replace provider imports and constants**

In `app/api/chat/route.ts`, remove:

```ts
import OpenAI from "openai";
import { getRequiredEnv, MissingEnvError } from "@/app/lib/env";
```

Add:

```ts
import type OpenAI from "openai";
import { toLlmErrorResponse } from "@/app/lib/llm/errors";
import { createOpenAIClient, runWithLlmFallback } from "@/app/lib/llm/provider";
```

Remove:

```ts
const MODEL = "deepseek-chat";
```

- [ ] **Step 2: Replace `createTextStream`**

Replace `createTextStream` with:

```ts
async function createTextStream(
  messages: ChatCompletionMessageParam[]
): Promise<ReadableStream<Uint8Array>> {
  const completion = await runWithLlmFallback(
    (provider) =>
      createOpenAIClient(provider).chat.completions.create({
        model: provider.model,
        messages,
        stream: true,
      }),
    { operationName: "chat stream" }
  );

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      for await (const chunk of completion) {
        const text = chunk.choices?.[0]?.delta?.content || "";
        controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });
}
```

- [ ] **Step 3: Replace client creation and model decision call**

Inside `POST`, remove the `apiKey` and `client` creation. Replace the decision call with:

```ts
const decision = await runWithLlmFallback(
  (provider) =>
    createOpenAIClient(provider).chat.completions.create({
      model: provider.model,
      messages: conversation,
      stream: false,
      tools: toolDefinitions,
      tool_choice: "auto",
    }),
  { operationName: "chat tool decision" }
);
```

Replace both calls to `createTextStream(client, conversation)` with:

```ts
const stream = await createTextStream(conversation);
```

- [ ] **Step 4: Replace MissingEnv catch branch**

Replace the whole `catch` block with:

```ts
  } catch (error) {
    console.error("Chat API error:", error);
    return toLlmErrorResponse(error);
  }
```

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(chat): use local-first llm provider"
```

## Task 5: Update Title And Compress Routes

**Files:**
- Modify: `app/api/title/route.ts`
- Modify: `app/api/compress/route.ts`

- [ ] **Step 1: Update title route imports**

In `app/api/title/route.ts`, remove:

```ts
import OpenAI from "openai";
import { getRequiredEnv, MissingEnvError } from "@/app/lib/env";
```

Add:

```ts
import { toLlmErrorResponse } from "@/app/lib/llm/errors";
import { createOpenAIClient, runWithLlmFallback } from "@/app/lib/llm/provider";
```

- [ ] **Step 2: Update title completion call**

Remove `apiKey` and `client` creation. Replace the completion call with:

```ts
const completion = await runWithLlmFallback(
  (provider) =>
    createOpenAIClient(provider).chat.completions.create({
      model: provider.model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `用户提问：\n${userMessage}\n\n助手回答：\n${assistantMessage ?? ""}`,
        },
      ],
    }),
  { operationName: "title generation" }
);
```

Replace the title route catch block with:

```ts
  } catch (error) {
    console.error("Title API error:", error);
    return toLlmErrorResponse(error);
  }
```

- [ ] **Step 3: Update compress route imports**

In `app/api/compress/route.ts`, remove:

```ts
import OpenAI from "openai";
import { getRequiredEnv, MissingEnvError } from "@/app/lib/env";
```

Add:

```ts
import { toLlmErrorResponse } from "@/app/lib/llm/errors";
import { createOpenAIClient, runWithLlmFallback } from "@/app/lib/llm/provider";
```

- [ ] **Step 4: Update compress completion call**

Remove `apiKey` and `client` creation. Replace the completion call with:

```ts
const completion = await runWithLlmFallback(
  (provider) =>
    createOpenAIClient(provider).chat.completions.create({
      model: provider.model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  { operationName: "conversation compression" }
);
```

Replace the compress route catch block with:

```ts
  } catch (error) {
    console.error("Compress API error:", error);
    return toLlmErrorResponse(error);
  }
```

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/title/route.ts app/api/compress/route.ts
git commit -m "feat(api): use local-first llm for utility routes"
```

## Task 6: Update Document Extraction Route

**Files:**
- Modify: `app/api/documents/extract/route.ts`

- [ ] **Step 1: Replace imports**

Remove:

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { getRequiredEnv, MissingEnvError } from '@/app/lib/env';
```

Add:

```ts
import { toLlmErrorResponse } from '@/app/lib/llm/errors';
import { createOpenAIClient, runWithLlmFallback } from '@/app/lib/llm/provider';
```

- [ ] **Step 2: Replace AI SDK call**

Remove `apiKey` and `deepseek` creation. Replace:

```ts
const { text } = await generateText({
  model: deepseek.chat('deepseek-chat'),
  prompt,
  temperature: 0.3,
});
```

with:

```ts
const completion = await runWithLlmFallback(
  (provider) =>
    createOpenAIClient(provider).chat.completions.create({
      model: provider.model,
      stream: false,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    }),
  { operationName: 'document extraction' }
);

const text = completion.choices?.[0]?.message?.content ?? '';
```

- [ ] **Step 3: Replace MissingEnv catch branch**

Replace the route catch block with:

```ts
  } catch (error) {
    console.error('Extract document error:', error);
    const llmResponse = toLlmErrorResponse(error);
    if (llmResponse.status !== 500) {
      return llmResponse;
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract document' },
      { status: 500 }
    );
  }
```

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/documents/extract/route.ts
git commit -m "feat(docs): use local-first llm extraction"
```

## Task 7: Update README For Ollama Local-First Setup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update intro and tech stack wording**

Change the opening paragraph so it says the default model path is Ollama local-first with DeepSeek fallback:

```md
基于 Next.js 16 + React 19 + Vercel AI SDK / OpenAI-compatible SDK 构建的本地 AI 对话工作平台，支持多会话管理、文件 RAG、语义搜索、上下文压缩和**开发问题文档系统**。模型默认优先接入本地 [Ollama](https://ollama.com/)（OpenAI-compatible 接口），并可在本地服务不可用时 fallback 到 [DeepSeek](https://platform.deepseek.com/)。
```

Update the model bullets in 技术栈:

```md
- **AI 调用**：OpenAI-compatible SDK（Ollama 本地优先，DeepSeek fallback）
- **对话模型**：默认 `qwen2.5-coder:7b`（Ollama）；fallback 为 `deepseek-chat`
```

- [ ] **Step 2: Replace environment setup section**

Replace the current “配置环境变量” section with:

````md
### 2. 准备本地模型（Ollama）

安装 Ollama 后拉取默认模型：

```bash
ollama pull qwen2.5-coder:7b
```

启动 Ollama 服务：

```bash
ollama serve
```

验证服务是否可用：

```bash
curl http://localhost:11434/api/tags
curl http://localhost:11434/v1/models
```

> `http://localhost:11434/v1` 是 OpenAI-compatible API base URL，不是浏览器页面；直接在浏览器打开可能不是可读页面。

### 3. 配置 DeepSeek fallback（可选）

创建 `.env.local` 文件：

```bash
DEEPSEEK_API_KEY=your_deepseek_api_key
```

可选配置：

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5-coder:7b
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

> 未配置 `DEEPSEEK_API_KEY` 时，Ollama 正常可用；只有 Ollama 不可用且需要 fallback 时，相关 API 才会返回 503。
````

Renumber later quick-start headings so dev server is step 4 and production build is step 5.

- [ ] **Step 3: Update remaining model wording**

Replace the 智能对话 bullet:

```md
- **流式响应**：服务端通过 OpenAI-compatible 接口优先调用本地 Ollama，失败时可 fallback 到 DeepSeek，实时流式输出
```

Replace the document extraction model sentence:

```md
3. **AI 提取**：调用当前配置的对话模型自动提取结构化信息
```

Replace the compression model sentence:

```md
- 将更早的消息通过当前配置的对话模型总结成摘要（如已有旧摘要会合并去重）
```

Keep the RAG embedding model text unchanged:

```md
- **嵌入模型**：`Xenova/all-MiniLM-L6-v2`（浏览器端 `@huggingface/transformers` 运行）
```

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document ollama local-first setup"
```

## Task 8: Final Verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run provider tests**

Run:

```bash
npm test -- app/lib/llm/provider.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only Ollama provider, route, test, package, and README changes are present.

- [ ] **Step 5: Commit final verification fixes if needed**

If verification required code changes, commit them:

```bash
git add app package.json package-lock.json README.md
git commit -m "fix: stabilize ollama local-first integration"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: provider layer, all four AI call sites, DeepSeek fallback, missing key behavior, README updates, lint/build verification are each covered by tasks.
- Placeholder scan: no task contains deferred implementation markers.
- Type consistency: `LlmProviderConfig`, `getLlmConfig`, `runWithLlmFallback`, `createOpenAIClient`, `MissingFallbackProviderError`, `ProviderCallError`, and `toLlmErrorResponse` names are consistent across tests and implementation tasks.
