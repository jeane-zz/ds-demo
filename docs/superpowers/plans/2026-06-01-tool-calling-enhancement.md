# Tool Calling Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强现有 3 个本地工具的调用稳定性和结果结构，让模型更可靠地按需查询本地资料。

**Architecture:** 保留现有 `app/lib/tools/registry.ts` 集中注册与 `app/api/chat/route.ts` 工具循环。新增 `toolUseInstruction` 作为 tool decision 专用 system message，统一工具结果字段为 `sourceType` 与 `*Snippet`，并用 Vitest 覆盖注册、执行、错误降级和结果结构。

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript strict mode, OpenAI-compatible tool calling types, Vitest.

---

## File Structure

- Create: `app/lib/tools/registry.test.ts`  
  Mock `DocumentDAO` 和 `MessageDAO`，覆盖工具定义、工具调用指令、错误降级和结构化结果。
- Modify: `app/lib/tools/registry.ts`  
  导出 `toolUseInstruction`，增强工具描述，统一工具结果结构。
- Modify: `app/api/chat/route.ts`  
  在 tool decision 请求中注入 `toolUseInstruction`，不改变前端纯文本流式协议。

## Task 1: Add Failing Tool Registry Tests

**Files:**
- Create: `app/lib/tools/registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/lib/tools/registry.test.ts`:

```ts
import type { ChatCompletionMessageToolCall } from "openai/resources/chat";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  documentSearch: vi.fn(),
  messageGetBySessionId: vi.fn(),
}));

vi.mock("@/app/lib/dao", () => ({
  DocumentDAO: {
    search: mocks.documentSearch,
  },
  MessageDAO: {
    getBySessionId: mocks.messageGetBySessionId,
  },
}));

import {
  executeToolCall,
  toolDefinitions,
  toolUseInstruction,
} from "./registry";

function createToolCall(
  name: string,
  args: string,
  type: "function" | "custom" = "function"
): ChatCompletionMessageToolCall {
  return {
    id: `call-${name}`,
    type,
    function: {
      name,
      arguments: args,
    },
  } as ChatCompletionMessageToolCall;
}

function parseToolResult(raw: string) {
  return JSON.parse(raw) as {
    ok: boolean;
    message?: string;
    data?: Array<Record<string, unknown>>;
  };
}

describe("toolDefinitions", () => {
  it("registers the three local search tools with descriptions and schemas", () => {
    const names = toolDefinitions.map((tool) => tool.function.name).sort();

    expect(names).toEqual([
      "search_conversation",
      "search_documents",
      "search_uploaded_files",
    ]);

    for (const tool of toolDefinitions) {
      expect(tool.type).toBe("function");
      expect(tool.function.description.length).toBeGreaterThan(20);
      expect(tool.function.parameters).toMatchObject({
        type: "object",
        properties: {
          query: expect.objectContaining({ type: "string" }),
        },
        required: ["query"],
      });
    }
  });
});

describe("toolUseInstruction", () => {
  it("names all tools and tells the model not to call tools when context is enough", () => {
    expect(toolUseInstruction).toContain("search_documents");
    expect(toolUseInstruction).toContain("search_conversation");
    expect(toolUseInstruction).toContain("search_uploaded_files");
    expect(toolUseInstruction).toContain("不要为了形式调用工具");
  });
});

describe("executeToolCall", () => {
  beforeEach(() => {
    mocks.documentSearch.mockReset();
    mocks.messageGetBySessionId.mockReset();
  });

  it("returns an error for unsupported tool call types", async () => {
    const result = parseToolResult(
      await executeToolCall(createToolCall("search_documents", "{}", "custom"), {})
    );

    expect(result).toEqual({
      ok: false,
      message: "Unsupported tool call type: custom",
    });
  });

  it("returns an error for unknown tools", async () => {
    const result = parseToolResult(
      await executeToolCall(createToolCall("unknown_tool", "{}"), {})
    );

    expect(result).toEqual({
      ok: false,
      message: "Unknown tool: unknown_tool",
    });
  });

  it("returns an error for invalid JSON arguments", async () => {
    const result = parseToolResult(
      await executeToolCall(createToolCall("search_documents", "{not-json"), {})
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/JSON|Expected property name|Unexpected token/);
  });

  it("returns an error for non-object arguments", async () => {
    const result = parseToolResult(
      await executeToolCall(createToolCall("search_documents", "[]"), {})
    );

    expect(result).toEqual({
      ok: false,
      message: "tool arguments must be a JSON object",
    });
  });

  it("returns an error when a session-scoped tool has no sessionId", async () => {
    const result = parseToolResult(
      await executeToolCall(
        createToolCall("search_conversation", JSON.stringify({ query: "React" })),
        {}
      )
    );

    expect(result).toEqual({
      ok: false,
      message: "sessionId is required for this tool",
    });
  });

  it("serializes document results with sourceType and snippet fields", async () => {
    mocks.documentSearch.mockReturnValue([
      {
        id: "doc-1",
        title: "React 状态更新",
        category: "React",
        tags: ["React", "state"],
        problem: "组件状态没有按预期更新",
        solution: "使用函数式 setState 避免闭包旧值",
        code: "setCount((count) => count + 1)",
        relatedSessionId: "session-1",
        updatedAt: 100,
      },
    ]);

    const result = parseToolResult(
      await executeToolCall(
        createToolCall("search_documents", JSON.stringify({ query: "state" })),
        {}
      )
    );

    expect(result.ok).toBe(true);
    expect(result.message).toBe("1 document found");
    expect(result.data?.[0]).toEqual({
      sourceType: "document",
      id: "doc-1",
      title: "React 状态更新",
      category: "React",
      tags: ["React", "state"],
      problemSnippet: "组件状态没有按预期更新",
      solutionSnippet: "使用函数式 setState 避免闭包旧值",
      codeSnippet: "setCount((count) => count + 1)",
      relatedSessionId: "session-1",
      updatedAt: 100,
    });
  });

  it("serializes conversation results with sourceType and contentSnippet", async () => {
    mocks.messageGetBySessionId.mockReturnValue([
      {
        role: "user",
        content: "之前讨论 React state 闭包问题",
        createdAt: 100,
      },
      {
        role: "assistant",
        content: "建议使用函数式更新",
        createdAt: 101,
      },
    ]);

    const result = parseToolResult(
      await executeToolCall(
        createToolCall("search_conversation", JSON.stringify({ query: "React" })),
        { sessionId: "session-1" }
      )
    );

    expect(result.ok).toBe(true);
    expect(result.message).toBe("1 conversation message found");
    expect(result.data?.[0]).toEqual({
      sourceType: "conversation",
      role: "user",
      contentSnippet: "之前讨论 React state 闭包问题",
      createdAt: 100,
    });
  });

  it("serializes uploaded file results with sourceType and contentSnippet", async () => {
    mocks.messageGetBySessionId.mockReturnValue([
      {
        role: "user",
        content: "`notes.md`:\n```\nReact state closure notes\n```",
        createdAt: 200,
      },
    ]);

    const result = parseToolResult(
      await executeToolCall(
        createToolCall("search_uploaded_files", JSON.stringify({ query: "closure" })),
        { sessionId: "session-1" }
      )
    );

    expect(result.ok).toBe(true);
    expect(result.message).toBe("1 uploaded file snippet found");
    expect(result.data?.[0]).toEqual({
      sourceType: "uploadedFile",
      fileName: "notes.md",
      contentSnippet: "React state closure notes",
      messageCreatedAt: 200,
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- app/lib/tools/registry.test.ts
```

Expected: FAIL because `toolUseInstruction` is not exported and the current result fields are `problem`, `solution`, `code`, and `content` instead of `*Snippet`.

- [ ] **Step 3: Commit failing tests**

```bash
git add app/lib/tools/registry.test.ts
git commit -m "test: cover local tool registry behavior"
```

## Task 2: Enhance Tool Registry Instruction And Result Shapes

**Files:**
- Modify: `app/lib/tools/registry.ts`
- Test: `app/lib/tools/registry.test.ts`

- [ ] **Step 1: Add `toolUseInstruction` export**

In `app/lib/tools/registry.ts`, add this after `const MAX_RESULTS = 5;`:

```ts
export const toolUseInstruction =
  "你可以按需调用本地工具来查询用户的本地知识。规则：\n" +
  "1. 当用户询问保存过的开发问题、文档库、归档方案、历史解决方案、分类或标签时，优先调用 search_documents。\n" +
  "2. 当用户询问当前会话之前讨论过什么、刚才说过什么、前文结论或本会话历史时，调用 search_conversation。\n" +
  "3. 当用户询问上传文件内容、某个文件、文件中的代码或文件片段时，调用 search_uploaded_files。\n" +
  "4. 如果当前消息上下文已经包含足够信息，可以直接回答，不要为了形式调用工具。\n" +
  "5. 如果工具没有找到结果，应明确说明没有找到，不要编造本地资料。\n" +
  "6. 工具结果只是本地检索片段，最终回答仍需结合用户问题进行总结。";
```

- [ ] **Step 2: Replace document serializer**

Replace `serializeDocument` with:

```ts
function serializeDocument(doc: Document) {
  return {
    sourceType: "document",
    id: doc.id,
    title: doc.title,
    category: doc.category,
    tags: doc.tags ?? [],
    problemSnippet: truncate(doc.problem, 500),
    solutionSnippet: truncate(doc.solution, 900),
    codeSnippet: truncate(doc.code, 700),
    relatedSessionId: doc.relatedSessionId,
    updatedAt: doc.updatedAt,
  };
}
```

- [ ] **Step 3: Improve tool descriptions and messages**

In the `search_documents` definition, replace the description with:

```ts
"Search the local saved development-problem document library. Use this for archived fixes, saved notes, documented solutions, categories, tags, or previous problems the user explicitly saved as documents."
```

Replace its return message with:

```ts
message:
  docs.length === 1
    ? "1 document found"
    : docs.length > 1
      ? `${docs.length} documents found`
      : "no matching documents",
```

In the `search_conversation` definition, replace the description with:

```ts
"Search the current local conversation history. Use this when the user asks what was discussed earlier, asks about previous conclusions in this session, or refers to something said before."
```

Replace its result mapper with:

```ts
data: results.map((message) => ({
  sourceType: "conversation",
  role: message.role,
  contentSnippet: truncate(message.content),
  createdAt: message.createdAt,
})),
```

Replace its return message with:

```ts
message:
  results.length === 1
    ? "1 conversation message found"
    : results.length > 1
      ? `${results.length} conversation messages found`
      : "no matching conversation messages",
```

In the `search_uploaded_files` definition, replace the description with:

```ts
"Search uploaded file contents that were included in user messages in the current session. Use this when the user asks about an uploaded file, file content, code from a file, or a specific filename."
```

Replace its result mapper with:

```ts
.map((item) => ({
  sourceType: "uploadedFile",
  fileName: item.file.fileName,
  contentSnippet: truncate(item.file.content),
  messageCreatedAt: item.file.messageCreatedAt,
}));
```

Replace its return message with:

```ts
message:
  results.length === 1
    ? "1 uploaded file snippet found"
    : results.length > 1
      ? `${results.length} uploaded file snippets found`
      : "no matching uploaded files",
```

- [ ] **Step 4: Run registry tests**

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
git commit -m "feat: improve local tool registry results"
```

## Task 3: Inject Tool-Use Instruction Into Chat Tool Decision

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Import the instruction**

In `app/api/chat/route.ts`, replace:

```ts
import { executeToolCall, toolDefinitions } from "@/app/lib/tools/registry";
```

with:

```ts
import {
  executeToolCall,
  toolDefinitions,
  toolUseInstruction,
} from "@/app/lib/tools/registry";
```

- [ ] **Step 2: Add decision messages**

Inside the tool loop, immediately before the `runWithLlmFallback` decision call, add:

```ts
const decisionMessages: ChatCompletionMessageParam[] = [
  ...conversation,
  { role: "system", content: toolUseInstruction },
];
```

Then replace the decision request `messages: conversation,` with:

```ts
messages: decisionMessages,
```

Do not add `toolUseInstruction` to `conversation` itself. It should guide tool selection but should not be duplicated into the final streaming response context.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(chat): guide local tool decisions"
```

## Task 4: Final Verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS, including provider tests and registry tests.

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

- [ ] **Step 4: Inspect git status and diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: working tree is clean after commits, or only intentional verification fixes are present.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes, commit them:

```bash
git add app/api/chat/route.ts app/lib/tools/registry.ts app/lib/tools/registry.test.ts
git commit -m "fix: stabilize local tool calling enhancement"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: tool-use instruction, existing 3 tools, structured result fields, current non-breaking error behavior, registry tests, and final verification are each covered.
- Placeholder scan: no task contains deferred implementation markers.
- Type consistency: `toolUseInstruction`, `toolDefinitions`, `executeToolCall`, `sourceType`, `problemSnippet`, `solutionSnippet`, `codeSnippet`, and `contentSnippet` are used consistently across tests and implementation steps.
