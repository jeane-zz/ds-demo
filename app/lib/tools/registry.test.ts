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
