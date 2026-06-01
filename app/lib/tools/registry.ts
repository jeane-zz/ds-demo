import type {
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat";
import { DocumentDAO, MessageDAO, type Document, type Message } from "@/app/lib/dao";

export interface ToolContext {
  sessionId?: string;
}

export interface ToolResult {
  ok: boolean;
  message?: string;
  data?: unknown;
}

type JsonObject = Record<string, unknown>;
type ToolExecutor = (args: JsonObject, context: ToolContext) => Promise<ToolResult>;

interface RegisteredTool {
  definition: ChatCompletionTool;
  execute: ToolExecutor;
}

const MAX_SNIPPET_LENGTH = 900;
const MAX_RESULTS = 5;

export const toolUseInstruction =
  "你可以按需调用本地工具来查询用户的本地知识。规则：\n" +
  "1. 当用户询问保存过的开发问题、文档库、归档方案、历史解决方案、分类或标签时，优先调用 search_documents。\n" +
  "2. 当用户询问当前会话之前讨论过什么、刚才说过什么、前文结论或本会话历史时，调用 search_conversation。\n" +
  "3. 当用户询问上传文件内容、某个文件、文件中的代码或文件片段时，调用 search_uploaded_files。\n" +
  "4. 如果当前消息上下文已经包含足够信息，可以直接回答，不要为了形式调用工具。\n" +
  "5. 如果工具没有找到结果，应明确说明没有找到，不要编造本地资料。\n" +
  "6. 工具结果只是本地检索片段，最终回答仍需结合用户问题进行总结。";

function asRequiredString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function requireSessionId(context: ToolContext): string {
  if (!context.sessionId) {
    throw new Error("sessionId is required for this tool");
  }
  return context.sessionId;
}

function truncate(text: string | undefined, maxLength = MAX_SNIPPET_LENGTH): string {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function safeJson(result: ToolResult): string {
  return JSON.stringify(result);
}

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

function scoreText(query: string, text: string): number {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length >= 2);

  if (terms.length === 0) return 0;

  const haystack = text.toLowerCase();
  return terms.reduce((score, term) => {
    if (!haystack.includes(term)) return score;
    return score + (haystack === term ? 3 : 1);
  }, 0);
}

function searchMessagesByText(messages: Message[], query: string): Message[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      message,
      score: scoreText(query, message.content),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.message.createdAt - a.message.createdAt)
    .slice(0, MAX_RESULTS)
    .map((item) => item.message);
}

function extractUploadedFiles(messages: Message[]) {
  const filePattern = /`([^`]+)`:\n```\n([\s\S]*?)```/g;
  const files: Array<{ fileName: string; content: string; messageCreatedAt: number }> = [];

  for (const message of messages) {
    if (message.role !== "user") continue;
    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(message.content)) !== null) {
      files.push({
        fileName: match[1],
        content: match[2],
        messageCreatedAt: message.createdAt,
      });
    }
  }

  return files;
}

const registeredTools: Record<string, RegisteredTool> = {
  search_documents: {
    definition: {
      type: "function",
      function: {
        name: "search_documents",
        description:
          "Search the local saved development-problem document library. Use this for archived fixes, saved notes, documented solutions, categories, tags, or previous problems the user explicitly saved as documents.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search keywords for the local document library.",
            },
          },
          required: ["query"],
        },
      },
    },
    async execute(args) {
      const query = asRequiredString(args, "query");
      const docs = DocumentDAO.search(query).slice(0, MAX_RESULTS);

      return {
        ok: true,
        message:
          docs.length === 1
            ? "1 document found"
            : docs.length > 1
              ? `${docs.length} documents found`
              : "no matching documents",
        data: docs.map(serializeDocument),
      };
    },
  },

  search_conversation: {
    definition: {
      type: "function",
      function: {
        name: "search_conversation",
        description:
          "Search the current local conversation history. Use this when the user asks what was discussed earlier, asks about previous conclusions in this session, or refers to something said before.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Keywords to find in the current conversation history.",
            },
          },
          required: ["query"],
        },
      },
    },
    async execute(args, context) {
      const sessionId = requireSessionId(context);
      const query = asRequiredString(args, "query");
      const messages = MessageDAO.getBySessionId(sessionId);
      const results = searchMessagesByText(messages, query);

      return {
        ok: true,
        message:
          results.length === 1
            ? "1 conversation message found"
            : results.length > 1
              ? `${results.length} conversation messages found`
              : "no matching conversation messages",
        data: results.map((message) => ({
          sourceType: "conversation",
          role: message.role,
          contentSnippet: truncate(message.content),
          createdAt: message.createdAt,
        })),
      };
    },
  },

  search_uploaded_files: {
    definition: {
      type: "function",
      function: {
        name: "search_uploaded_files",
        description:
          "Search uploaded file contents that were included in user messages in the current session. Use this when the user asks about an uploaded file, file content, code from a file, or a specific filename.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Keywords to find in uploaded file contents.",
            },
          },
          required: ["query"],
        },
      },
    },
    async execute(args, context) {
      const sessionId = requireSessionId(context);
      const query = asRequiredString(args, "query");
      const messages = MessageDAO.getBySessionId(sessionId);
      const files = extractUploadedFiles(messages);
      const results = files
        .map((file) => ({
          file,
          score: scoreText(query, `${file.fileName}\n${file.content}`),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.file.messageCreatedAt - a.file.messageCreatedAt)
        .slice(0, MAX_RESULTS)
        .map((item) => ({
          sourceType: "uploadedFile",
          fileName: item.file.fileName,
          contentSnippet: truncate(item.file.content),
          messageCreatedAt: item.file.messageCreatedAt,
        }));

      return {
        ok: true,
        message:
          results.length === 1
            ? "1 uploaded file snippet found"
            : results.length > 1
              ? `${results.length} uploaded file snippets found`
              : "no matching uploaded files",
        data: results,
      };
    },
  },
};

export const toolDefinitions: ChatCompletionTool[] = Object.values(registeredTools).map(
  (tool) => tool.definition
);

export async function executeToolCall(
  toolCall: ChatCompletionMessageToolCall,
  context: ToolContext
): Promise<string> {
  if (toolCall.type !== "function") {
    return safeJson({
      ok: false,
      message: `Unsupported tool call type: ${toolCall.type}`,
    });
  }

  const tool = registeredTools[toolCall.function.name];
  if (!tool) {
    return safeJson({
      ok: false,
      message: `Unknown tool: ${toolCall.function.name}`,
    });
  }

  try {
    const parsed = JSON.parse(toolCall.function.arguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("tool arguments must be a JSON object");
    }

    const result = await tool.execute(parsed as JsonObject, context);
    return safeJson(result);
  } catch (error) {
    return safeJson({
      ok: false,
      message: error instanceof Error ? error.message : "Tool execution failed",
    });
  }
}
