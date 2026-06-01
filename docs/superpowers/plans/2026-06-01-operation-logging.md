# Operation Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为服务端 AI/provider/tool/API 调用建立最小可用的 SQLite 操作日志闭环，支持后端查询且不记录完整 prompt 或敏感信息。

**Architecture:** 在现有 SQLite/DAO 层新增 `operation_logs` 表与 `OperationLogDAO`，用一个小型 `safeCreateOperationLog` helper 做摘要截断和失败隔离。工具调用边界、LLM fallback 边界和 `/api/operation-logs` 查询接口分别接入日志；第一期不做前端 UI。

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript strict mode, better-sqlite3, Vitest.

---

## File Structure

- Modify: `app/lib/db.ts`  
  创建 `operation_logs` 表和索引。
- Modify: `app/lib/dao.ts`  
  新增 `OperationLog` 类型、`OperationLogInput` 类型和 `OperationLogDAO`。
- Create: `app/lib/operationLog.ts`  
  提供摘要截断、结果数量提取和安全写日志 helper。
- Create: `app/lib/operationLog.test.ts`  
  覆盖 DAO 写入、查询、limit 保护和摘要脱敏/截断。
- Modify: `app/lib/tools/registry.ts`  
  在 `executeToolCall` 边界记录工具调用日志。
- Modify: `app/lib/tools/registry.test.ts`  
  Mock 日志 helper，验证工具成功/失败时写日志。
- Modify: `app/lib/llm/provider.ts`  
  在 provider primary/fallback 尝试边界记录 LLM 日志。
- Modify: `app/lib/llm/provider.test.ts`  
  Mock 日志 helper，验证 primary 成功、fallback 成功、全部失败的日志。
- Create: `app/api/operation-logs/route.ts`  
  提供 `GET /api/operation-logs?sessionId=&limit=`。
- Create: `app/api/operation-logs/route.test.ts`  
  Mock DAO，验证查询参数和错误响应。
- Modify: `README.md`  
  说明操作日志能力，并将“错误处理 + 操作日志”标记为已完成。

## Task 1: Operation Log Storage And DAO

**Files:**
- Modify: `app/lib/db.ts`
- Modify: `app/lib/dao.ts`
- Create: `app/lib/operationLog.test.ts`

- [ ] **Step 1: Write failing DAO tests**

Create `app/lib/operationLog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { OperationLogDAO } from "./dao";
import {
  countResultItems,
  safeCreateOperationLog,
  summarizeForLog,
} from "./operationLog";

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("OperationLogDAO", () => {
  it("creates and queries recent logs by sessionId", () => {
    const sessionId = uniqueId("session");

    OperationLogDAO.create({
      sessionId,
      type: "tool",
      operation: "search_documents",
      status: "success",
      inputSummary: "query=react",
      outputSummary: "1 document found; results=1",
      durationMs: 12,
    });

    const logs = OperationLogDAO.getRecent({ sessionId, limit: 10 });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      sessionId,
      type: "tool",
      operation: "search_documents",
      status: "success",
      inputSummary: "query=react",
      outputSummary: "1 document found; results=1",
      durationMs: 12,
    });
    expect(logs[0].id).toMatch(/^log_/);
    expect(typeof logs[0].createdAt).toBe("number");
  });

  it("uses default and maximum limits", () => {
    const sessionId = uniqueId("session");
    for (let i = 0; i < 3; i++) {
      OperationLogDAO.create({
        sessionId,
        type: "api",
        operation: `operation-${i}`,
        status: "success",
      });
    }

    expect(OperationLogDAO.getRecent({ sessionId }).length).toBe(3);
    expect(OperationLogDAO.getRecent({ sessionId, limit: 500 }).length).toBe(3);
    expect(OperationLogDAO.getRecent({ sessionId, limit: 1 })).toHaveLength(1);
  });
});

describe("operation log helpers", () => {
  it("summarizes strings and objects without leaking long content", () => {
    const longText = "x".repeat(600);
    expect(summarizeForLog(longText, 20)).toBe(`${"x".repeat(20)}...`);
    expect(summarizeForLog({ query: "react", nested: true })).toBe(
      "{\"query\":\"react\",\"nested\":true}"
    );
  });

  it("counts array results inside tool payloads", () => {
    expect(countResultItems({ ok: true, data: [{ id: 1 }, { id: 2 }] })).toBe(2);
    expect(countResultItems({ ok: false, message: "failed" })).toBe(0);
  });

  it("does not throw when safe log creation receives bad input", () => {
    expect(() =>
      safeCreateOperationLog({
        type: "tool",
        operation: "unit-test",
        status: "success",
        inputSummary: "ok",
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- app/lib/operationLog.test.ts
```

Expected: FAIL because `OperationLogDAO` and `app/lib/operationLog.ts` do not exist yet.

- [ ] **Step 3: Add the database table**

In `app/lib/db.ts`, inside the initial `db.exec` block after the `documents` table, add:

```ts
  CREATE TABLE IF NOT EXISTS operation_logs (
    id TEXT PRIMARY KEY,
    sessionId TEXT,
    type TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    inputSummary TEXT,
    outputSummary TEXT,
    errorMessage TEXT,
    durationMs INTEGER,
    createdAt INTEGER NOT NULL
  );
```

In the same `db.exec` block after existing indexes, add:

```ts
  CREATE INDEX IF NOT EXISTS idx_operation_logs_session_created
    ON operation_logs(sessionId, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_operation_logs_type_status
    ON operation_logs(type, status);
  CREATE INDEX IF NOT EXISTS idx_operation_logs_created
    ON operation_logs(createdAt DESC);
```

- [ ] **Step 4: Add DAO types and methods**

In `app/lib/dao.ts`, after the `Document` interface, add:

```ts
export type OperationLogType = "chat" | "tool" | "llm" | "api";
export type OperationLogStatus = "success" | "error";

export interface OperationLog {
  id: string;
  sessionId?: string;
  type: OperationLogType;
  operation: string;
  status: OperationLogStatus;
  inputSummary?: string;
  outputSummary?: string;
  errorMessage?: string;
  durationMs?: number;
  createdAt: number;
}

export interface OperationLogInput {
  id?: string;
  sessionId?: string;
  type: OperationLogType;
  operation: string;
  status: OperationLogStatus;
  inputSummary?: string;
  outputSummary?: string;
  errorMessage?: string;
  durationMs?: number;
  createdAt?: number;
}

interface OperationLogRow {
  id: string;
  sessionId: string | null;
  type: OperationLogType;
  operation: string;
  status: OperationLogStatus;
  inputSummary: string | null;
  outputSummary: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: number;
}

function mapOperationLog(row: OperationLogRow): OperationLog {
  return {
    id: row.id,
    sessionId: row.sessionId || undefined,
    type: row.type,
    operation: row.operation,
    status: row.status,
    inputSummary: row.inputSummary || undefined,
    outputSummary: row.outputSummary || undefined,
    errorMessage: row.errorMessage || undefined,
    durationMs: row.durationMs ?? undefined,
    createdAt: row.createdAt,
  };
}
```

At the end of `app/lib/dao.ts`, after `DocumentDAO`, add:

```ts
const DEFAULT_OPERATION_LOG_LIMIT = 100;
const MAX_OPERATION_LOG_LIMIT = 200;

function createOperationLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOperationLogLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) {
    return DEFAULT_OPERATION_LOG_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_OPERATION_LOG_LIMIT);
}

export class OperationLogDAO {
  static create(log: OperationLogInput): void {
    db.prepare(`
      INSERT INTO operation_logs (
        id, sessionId, type, operation, status, inputSummary,
        outputSummary, errorMessage, durationMs, createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      log.id ?? createOperationLogId(),
      log.sessionId || null,
      log.type,
      log.operation,
      log.status,
      log.inputSummary || null,
      log.outputSummary || null,
      log.errorMessage || null,
      log.durationMs ?? null,
      log.createdAt ?? Date.now()
    );
  }

  static getRecent(options: { sessionId?: string; limit?: number } = {}): OperationLog[] {
    const limit = normalizeOperationLogLimit(options.limit);

    if (options.sessionId) {
      const rows = db.prepare(`
        SELECT id, sessionId, type, operation, status, inputSummary,
          outputSummary, errorMessage, durationMs, createdAt
        FROM operation_logs
        WHERE sessionId = ?
        ORDER BY createdAt DESC
        LIMIT ?
      `).all(options.sessionId, limit) as OperationLogRow[];

      return rows.map(mapOperationLog);
    }

    const rows = db.prepare(`
      SELECT id, sessionId, type, operation, status, inputSummary,
        outputSummary, errorMessage, durationMs, createdAt
      FROM operation_logs
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(limit) as OperationLogRow[];

    return rows.map(mapOperationLog);
  }
}
```

- [ ] **Step 5: Add safe logging helpers**

Create `app/lib/operationLog.ts`:

```ts
import { OperationLogDAO, type OperationLogInput } from "./dao";

const DEFAULT_SUMMARY_LIMIT = 500;

export function summarizeForLog(value: unknown, maxLength = DEFAULT_SUMMARY_LIMIT): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

export function countResultItems(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data) ? data.length : 0;
}

export function safeCreateOperationLog(log: OperationLogInput): void {
  try {
    OperationLogDAO.create({
      ...log,
      inputSummary: summarizeForLog(log.inputSummary),
      outputSummary: summarizeForLog(log.outputSummary),
      errorMessage: summarizeForLog(log.errorMessage),
    });
  } catch (error) {
    console.warn(
      "Failed to write operation log:",
      error instanceof Error ? error.message : error
    );
  }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- app/lib/operationLog.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/lib/db.ts app/lib/dao.ts app/lib/operationLog.ts app/lib/operationLog.test.ts
git commit -m "feat: add operation log storage"
```

## Task 2: Tool Call Operation Logs

**Files:**
- Modify: `app/lib/tools/registry.ts`
- Modify: `app/lib/tools/registry.test.ts`

- [ ] **Step 1: Update tests to mock log helper**

In `app/lib/tools/registry.test.ts`, extend the hoisted mocks:

```ts
const mocks = vi.hoisted(() => ({
  documentSearch: vi.fn(),
  messageGetBySessionId: vi.fn(),
  safeCreateOperationLog: vi.fn(),
}));
```

Add this mock after the DAO mock:

```ts
vi.mock("@/app/lib/operationLog", () => ({
  countResultItems: (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    const data = (value as { data?: unknown }).data;
    return Array.isArray(data) ? data.length : 0;
  },
  safeCreateOperationLog: mocks.safeCreateOperationLog,
  summarizeForLog: (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value),
}));
```

In `beforeEach`, add:

```ts
mocks.safeCreateOperationLog.mockReset();
```

Add this test inside `describe("executeToolCall", ...)`:

```ts
it("writes a success operation log for tool calls", async () => {
  mocks.documentSearch.mockReturnValue([]);

  await executeToolCall(
    createToolCall("search_documents", JSON.stringify({ query: "react" })),
    { sessionId: "session-1" }
  );

  expect(mocks.safeCreateOperationLog).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "session-1",
      type: "tool",
      operation: "search_documents",
      status: "success",
      inputSummary: "query=react",
      outputSummary: "no matching documents; results=0",
    })
  );
  expect(mocks.safeCreateOperationLog.mock.calls[0][0].durationMs).toEqual(
    expect.any(Number)
  );
});

it("writes an error operation log for failed tool calls", async () => {
  await executeToolCall(
    createToolCall("search_conversation", JSON.stringify({ query: "react" })),
    {}
  );

  expect(mocks.safeCreateOperationLog).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "tool",
      operation: "search_conversation",
      status: "error",
      inputSummary: "query=react",
      errorMessage: "sessionId is required for this tool",
    })
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- app/lib/tools/registry.test.ts
```

Expected: FAIL because `executeToolCall` does not write operation logs yet.

- [ ] **Step 3: Implement tool logging**

In `app/lib/tools/registry.ts`, add:

```ts
import {
  countResultItems,
  safeCreateOperationLog,
  summarizeForLog,
} from "@/app/lib/operationLog";
```

Add helper functions before `executeToolCall`:

```ts
function getToolOperationName(toolCall: ChatCompletionMessageToolCall): string {
  return toolCall.type === "function" ? toolCall.function.name : toolCall.type;
}

function summarizeToolArgs(args: JsonObject): string | undefined {
  const query = args.query;
  if (typeof query === "string" && query.trim()) {
    return `query=${summarizeForLog(query, 200)}`;
  }
  return summarizeForLog(args, 200);
}

function summarizeToolOutput(result: ToolResult): string | undefined {
  const parts = [result.message, `results=${countResultItems(result)}`].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : undefined;
}
```

Replace `executeToolCall` with:

```ts
export async function executeToolCall(
  toolCall: ChatCompletionMessageToolCall,
  context: ToolContext
): Promise<string> {
  const startedAt = Date.now();
  const operation = getToolOperationName(toolCall);
  let inputSummary: string | undefined;

  const finish = (result: ToolResult): string => {
    safeCreateOperationLog({
      sessionId: context.sessionId,
      type: "tool",
      operation,
      status: result.ok ? "success" : "error",
      inputSummary,
      outputSummary: result.ok ? summarizeToolOutput(result) : undefined,
      errorMessage: result.ok ? undefined : result.message,
      durationMs: Date.now() - startedAt,
    });
    return safeJson(result);
  };

  if (toolCall.type !== "function") {
    return finish({
      ok: false,
      message: `Unsupported tool call type: ${toolCall.type}`,
    });
  }

  const tool = registeredTools[toolCall.function.name];
  if (!tool) {
    return finish({
      ok: false,
      message: `Unknown tool: ${toolCall.function.name}`,
    });
  }

  try {
    const parsed = JSON.parse(toolCall.function.arguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("tool arguments must be a JSON object");
    }

    inputSummary = summarizeToolArgs(parsed as JsonObject);
    const result = await tool.execute(parsed as JsonObject, context);
    return finish(result);
  } catch (error) {
    return finish({
      ok: false,
      message: error instanceof Error ? error.message : "Tool execution failed",
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- app/lib/tools/registry.test.ts
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
git add app/lib/tools/registry.ts app/lib/tools/registry.test.ts
git commit -m "feat: log local tool calls"
```

## Task 3: LLM Provider Operation Logs

**Files:**
- Modify: `app/lib/llm/provider.ts`
- Modify: `app/lib/llm/provider.test.ts`

- [ ] **Step 1: Mock log helper in provider tests**

In `app/lib/llm/provider.test.ts`, add after imports:

```ts
vi.mock("@/app/lib/operationLog", () => ({
  safeCreateOperationLog: vi.fn(),
}));

import { safeCreateOperationLog } from "@/app/lib/operationLog";

const mockedSafeCreateOperationLog = vi.mocked(safeCreateOperationLog);
```

Add `beforeEach`:

```ts
beforeEach(() => {
  mockedSafeCreateOperationLog.mockReset();
});
```

Update the Vitest import to include `beforeEach`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
```

Add this test in `describe("runWithLlmFallback", ...)`:

```ts
it("logs a primary provider success", async () => {
  const operation = vi.fn().mockResolvedValue("ollama result");

  await runWithLlmFallback(operation, {
    operationName: "unit test",
    config: getLlmConfig({}),
    logger: { warn: vi.fn(), error: vi.fn() },
  });

  expect(mockedSafeCreateOperationLog).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "llm",
      operation: "unit test",
      status: "success",
      inputSummary: "provider=ollama",
      outputSummary: "provider=ollama; fallback=false",
    })
  );
});

it("logs fallback provider success after primary failure", async () => {
  const operation = vi
    .fn()
    .mockRejectedValueOnce(new Error("ollama down"))
    .mockResolvedValueOnce("deepseek result");

  await runWithLlmFallback(operation, {
    operationName: "unit test",
    config: getLlmConfig({ DEEPSEEK_API_KEY: "deepseek-key" }),
    logger: { warn: vi.fn(), error: vi.fn() },
  });

  expect(mockedSafeCreateOperationLog).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "llm",
      operation: "unit test",
      status: "error",
      inputSummary: "provider=ollama",
      errorMessage: "ollama down",
    })
  );
  expect(mockedSafeCreateOperationLog).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "llm",
      operation: "unit test",
      status: "success",
      inputSummary: "provider=deepseek",
      outputSummary: "provider=deepseek; fallback=true",
    })
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- app/lib/llm/provider.test.ts
```

Expected: FAIL because provider calls are not logged yet.

- [ ] **Step 3: Implement provider logging**

In `app/lib/llm/provider.ts`, add:

```ts
import { safeCreateOperationLog } from "@/app/lib/operationLog";
```

Inside `runWithLlmFallback`, before the primary `try`, add:

```ts
  const primaryStartedAt = Date.now();
```

Inside the primary success path, replace:

```ts
    return await operation(config.primary);
```

with:

```ts
    const result = await operation(config.primary);
    safeCreateOperationLog({
      type: "llm",
      operation: options.operationName,
      status: "success",
      inputSummary: `provider=${config.primary.name}`,
      outputSummary: `provider=${config.primary.name}; fallback=false`,
      durationMs: Date.now() - primaryStartedAt,
    });
    return result;
```

Inside the primary catch, before `logger.warn`, add:

```ts
    safeCreateOperationLog({
      type: "llm",
      operation: options.operationName,
      status: "error",
      inputSummary: `provider=${config.primary.name}`,
      errorMessage: summarizeError(primaryError),
      durationMs: Date.now() - primaryStartedAt,
    });
```

Before the fallback `try`, add:

```ts
  const fallbackStartedAt = Date.now();
```

Inside the fallback success path, replace:

```ts
    return await operation(config.fallback);
```

with:

```ts
    const result = await operation(config.fallback);
    safeCreateOperationLog({
      type: "llm",
      operation: options.operationName,
      status: "success",
      inputSummary: `provider=${config.fallback.name}`,
      outputSummary: `provider=${config.fallback.name}; fallback=true`,
      durationMs: Date.now() - fallbackStartedAt,
    });
    return result;
```

Inside the fallback catch, before `logger.error`, add:

```ts
    safeCreateOperationLog({
      type: "llm",
      operation: options.operationName,
      status: "error",
      inputSummary: `provider=${config.fallback.name}`,
      errorMessage: summarizeError(fallbackError),
      durationMs: Date.now() - fallbackStartedAt,
    });
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
git add app/lib/llm/provider.ts app/lib/llm/provider.test.ts
git commit -m "feat: log llm provider calls"
```

## Task 4: Operation Logs API

**Files:**
- Create: `app/api/operation-logs/route.ts`
- Create: `app/api/operation-logs/route.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `app/api/operation-logs/route.test.ts`:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRecent: vi.fn(),
}));

vi.mock("@/app/lib/dao", () => ({
  OperationLogDAO: {
    getRecent: mocks.getRecent,
  },
}));

import { GET } from "./route";

function createRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/operation-logs", () => {
  beforeEach(() => {
    mocks.getRecent.mockReset();
  });

  it("returns recent logs with sessionId and limit", async () => {
    mocks.getRecent.mockReturnValue([
      {
        id: "log-1",
        sessionId: "session-1",
        type: "tool",
        operation: "search_documents",
        status: "success",
        createdAt: 100,
      },
    ]);

    const response = await GET(
      createRequest("http://localhost/api/operation-logs?sessionId=session-1&limit=10")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      logs: [
        {
          id: "log-1",
          sessionId: "session-1",
          type: "tool",
          operation: "search_documents",
          status: "success",
          createdAt: 100,
        },
      ],
    });
    expect(mocks.getRecent).toHaveBeenCalledWith({
      sessionId: "session-1",
      limit: 10,
    });
  });

  it("omits empty sessionId and invalid limit", async () => {
    mocks.getRecent.mockReturnValue([]);

    const response = await GET(
      createRequest("http://localhost/api/operation-logs?sessionId=&limit=abc")
    );

    expect(response.status).toBe(200);
    expect(mocks.getRecent).toHaveBeenCalledWith({
      sessionId: undefined,
      limit: undefined,
    });
  });

  it("returns 500 when DAO throws", async () => {
    mocks.getRecent.mockImplementation(() => {
      throw new Error("db failed");
    });

    const response = await GET(createRequest("http://localhost/api/operation-logs"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch operation logs",
    });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- app/api/operation-logs/route.test.ts
```

Expected: FAIL because `app/api/operation-logs/route.ts` does not exist yet.

- [ ] **Step 3: Implement API route**

Create `app/api/operation-logs/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { OperationLogDAO } from "@/app/lib/dao";

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId")?.trim() || undefined;
    const limit = parseLimit(searchParams.get("limit"));

    const logs = OperationLogDAO.getRecent({ sessionId, limit });
    return NextResponse.json({ logs });
  } catch (error) {
    console.error("Failed to fetch operation logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch operation logs" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run API tests**

Run:

```bash
npm test -- app/api/operation-logs/route.test.ts
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
git add app/api/operation-logs/route.ts app/api/operation-logs/route.test.ts
git commit -m "feat: add operation logs api"
```

## Task 5: README And Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

In `README.md`, add this bullet under “核心功能” after “本地工具调用”:

```md
- **操作日志**：服务端记录 LLM provider、fallback、工具调用和 API 异常摘要，便于排查本地模型和工具链问题
```

In “技术亮点 / 工程实践”, add:

```md
- **可追踪性**：服务端记录 AI/provider/tool 运行摘要，日志仅保存必要摘要，不保存完整 prompt 或 API key
```

In “开发计划 / 已完成”, add:

```md
- [x] 错误处理 + 操作日志（后端最小闭环）
```

Remove `错误处理 + 操作日志` from “规划中”.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
git diff --stat
```

Expected: only README changes are present before commit.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document operation logging"
```

## Self-Review

- Spec coverage: database table, DAO, safe logging, tool logs, provider logs, query API, README, and final verification are all covered.
- Placeholder scan: no task contains deferred implementation markers.
- Type consistency: `OperationLog`, `OperationLogInput`, `OperationLogDAO`, `safeCreateOperationLog`, `summarizeForLog`, `countResultItems`, `type`, `operation`, `status`, and summary fields are consistent across tasks.
