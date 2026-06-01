# 工具调用增强设计

## 目标

增强现有服务端工具调用能力，让模型更稳定地在需要时调用本地工具，并让工具结果结构更清晰、更容易被模型用于最终回答。

## 范围

本设计覆盖当前已有工具调用链路：

- `app/api/chat/route.ts` 中的 tool decision 和工具执行循环
- `app/lib/tools/registry.ts` 中的工具注册、工具描述、工具执行和结果序列化
- 现有 3 个本地工具：
  - `search_documents`
  - `search_conversation`
  - `search_uploaded_files`

本次不改前端 `/api/chat` 纯文本流式协议，不展示真实工具调用事件，不新增工具权限 UI。

## 当前实现

当前系统已有两套本地知识增强机制：

1. 客户端 RAG 预注入
   - `useSessionWithDB.ts` 在请求 `/api/chat` 前做对话 RAG 和文件 RAG。
   - 检索结果作为 `system` 消息拼入最终消息。

2. 服务端 tool calling
   - `app/api/chat/route.ts` 让模型先决定是否调用工具。
   - 最多执行 2 轮工具调用。
   - 工具结果进入模型上下文，但不展示给前端。

当前主要问题：

- 工具和客户端 RAG 有能力重叠，但模型缺少明确决策规则。
- 工具描述主要依赖 OpenAI tool description，缺少统一的 tool-use system instruction。
- 工具结果字段不够统一，部分字段像完整内容，实际只是片段。
- 工具执行失败时已有降级策略，但缺少测试覆盖。

## 已确认决策

- 第一阶段只增强现有工具调用，不做前端工具调用过程展示。
- 保留 `app/lib/tools/registry.ts` 的集中注册模型。
- 保留当前“工具失败不打断整次对话”的策略。
- 新增工具调用指令和更结构化的工具结果。
- 增加针对工具注册与执行入口的单元测试。

## 架构

保持当前两层增强并存：

- 客户端 RAG 继续负责自动注入最相关上下文。
- 服务端 tool calling 继续负责模型按需主动查询本地资料。

服务端工具调用增强如下：

- 在 `app/lib/tools/registry.ts` 导出 `toolUseInstruction`。
- `toolUseInstruction` 是一段 system instruction，用于告诉模型：
  - 什么时候调用 `search_documents`
  - 什么时候调用 `search_conversation`
  - 什么时候调用 `search_uploaded_files`
  - 当前上下文足够时不要为了形式调用工具
- 在 `app/api/chat/route.ts` 发起 tool decision 前，将 `toolUseInstruction` 作为额外 system message 加入 decision 消息。
- 工具执行入口继续使用 `executeToolCall(toolCall, { sessionId })`。

## 工具调用规则

`toolUseInstruction` 应包含以下规则：

- 当用户询问保存过的开发问题、文档库、归档方案、历史解决方案、分类或标签时，优先调用 `search_documents`。
- 当用户询问当前会话之前讨论过什么、刚才说过什么、前文结论或本会话历史时，调用 `search_conversation`。
- 当用户询问上传文件内容、某个文件、文件中的代码或文件片段时，调用 `search_uploaded_files`。
- 如果当前消息上下文已经包含足够信息，可以直接回答，不要调用工具。
- 如果工具没有找到结果，应明确说明没有找到，不要编造本地资料。
- 工具结果只是本地检索片段，最终回答仍需结合用户问题进行总结。

## 工具结果结构

保留当前外层结构：

```ts
interface ToolResult {
  ok: boolean;
  message?: string;
  data?: unknown;
}
```

但将 `data` 统一为结构化数组。

### `search_documents`

每条结果使用：

```ts
{
  sourceType: "document";
  id: string;
  title: string;
  category: string;
  tags: string[];
  problemSnippet: string;
  solutionSnippet: string;
  codeSnippet: string;
  relatedSessionId?: string;
  updatedAt: number;
}
```

### `search_conversation`

每条结果使用：

```ts
{
  sourceType: "conversation";
  role: string;
  contentSnippet: string;
  createdAt: number;
}
```

### `search_uploaded_files`

每条结果使用：

```ts
{
  sourceType: "uploadedFile";
  fileName: string;
  contentSnippet: string;
  messageCreatedAt: number;
}
```

字段命名使用 `*Snippet`，明确这是片段，不是完整原文。截断逻辑继续复用现有 `truncate`。

## 错误处理

工具失败不打断整次对话，继续返回 JSON 字符串形式的工具结果：

- 未知工具：`{ ok: false, message: "Unknown tool: <name>" }`
- 非 function tool call：`{ ok: false, message: "Unsupported tool call type: <type>" }`
- 参数不是 JSON object：`{ ok: false, message: "tool arguments must be a JSON object" }`
- 缺少 `sessionId`：`{ ok: false, message: "sessionId is required for this tool" }`
- DAO 查询或工具内部异常：`{ ok: false, message: error.message }`

工具执行日志可以继续保留在服务端，但不应输出完整用户 prompt 或敏感内容。

## 测试

新增 `app/lib/tools/registry.test.ts`，覆盖：

- `toolDefinitions` 包含 3 个工具。
- 每个工具都有非空 `name`、`description` 和参数 schema。
- `toolUseInstruction` 包含 3 个工具名。
- `toolUseInstruction` 包含“不需要时不要调用工具”的规则。
- `executeToolCall` 能处理未知工具。
- `executeToolCall` 能处理非法 JSON 参数。
- `executeToolCall` 能处理非 object 参数。
- `executeToolCall` 缺少 `sessionId` 时返回错误。
- 工具结果包含统一的 `sourceType` 和 `*Snippet` 字段。

最终验证命令：

```bash
npm test
npm run lint
npm run build
```

## 非目标

- 不新增前端工具调用状态展示。
- 不把 `/api/chat` 改成事件流或 SSE。
- 不新增读取文件系统、执行命令、访问网络等高权限工具。
- 不重构客户端 RAG。
- 不把每个工具拆成独立文件，除非实现时测试或类型边界需要很小的辅助拆分。

## 验收标准

- 模型在 tool decision 阶段能收到明确的工具调用规则。
- 3 个现有工具的描述更清晰。
- 3 个现有工具返回结构统一且字段名明确。
- 工具失败仍能被安全序列化为 `{ ok: false, message }`。
- 新增工具注册与执行测试。
- `npm test`、`npm run lint`、`npm run build` 通过。
