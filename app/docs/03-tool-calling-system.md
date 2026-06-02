# 本地工具调用（Tool Calling）系统方案

> 关键词：Function Calling · 服务端执行 · 多轮决策 · 指令注入 · 结构化结果

---

## 1. 问题与目标

LLM 的静态训练知识无法了解用户本地数据。需要让 LLM 能在对话中**主动查询**本地存储的文档库、会话历史和上传文件内容，从而实现更精准的上下文感知回答。

目标：
1. 让 LLM 自主判断何时需要查询本地知识
2. 提供统一的注册-执行机制，方便扩展工具
3. 限制工具调用轮数，防止无限循环
4. 工具结果格式化，便于 LLM 理解和使用

## 2. 整体架构

```
用户请求 → /api/chat
    │
    ├── 第1轮：注入 toolUseInstruction → 请求 LLM（含 tools 定义）
    │         LLM 返回：tool_calls 或直接文本回复
    │         ↓ 有 tool_calls
    │         └── 执行工具（服务端，DAO 查 SQLite）
    │              └── 结果注入 conversation
    │
    ├── 第2轮：同上（最多 MAX_TOOL_ROUNDS = 2）
    │
    └── 超过轮数 → 注入"已到最大轮次"提示 → LLM 基于已有结果回答
         │ 无 tool_calls → 直接创建流式响应返回
```

## 3. 工具注册机制

### 3.1 定义结构

```typescript
// app/lib/tools/registry.ts

interface RegisteredTool {
  definition: ChatCompletionTool;  // OpenAI tool 定义格式
  execute: ToolExecutor;           // 执行函数
}

type ToolExecutor = (
  args: JsonObject,          // 解析后的参数
  context: ToolContext        // 包含 sessionId
) => Promise<ToolResult>;
```

工具以 `key-value` 形式存在 `registeredTools` Map 中，key 是工具名。

### 3.2 注册的三个工具

| 工具名 | 触发场景 | 数据源 | 必需参数 |
|--------|----------|--------|----------|
| `search_documents` | 用户询问已保存的文档、历史解决方案 | SQLite documents 表 | `query` |
| `search_conversation` | 用户问之前讨论过什么 | SQLite messages 表 | `query` |
| `search_uploaded_files` | 用户询问上传的文件内容 | SQLite messages（解析文件格式） | `query` |

## 4. 指令注入技术

为了让 LLM 正确使用工具，在发送给 LLM 的消息中注入详细的 **`toolUseInstruction`**：

```typescript
export const toolUseInstruction =
  "你可以按需调用本地工具来查询用户的本地知识。规则：\n" +
  "1. 当用户询问保存过的开发问题、文档库、归档方案……时，优先调用 search_documents。\n" +
  "2. 当用户询问当前会话之前讨论过什么……时，调用 search_conversation。\n" +
  "3. 当用户询问上传文件内容、文件中的代码时，调用 search_uploaded_files。\n" +
  "4. 如果当前消息上下文已经包含足够信息，可以直接回答，不要为了形式调用工具。\n" +
  "5. 如果工具没有找到结果，应明确说明没有找到，不要编造本地资料。\n" +
  "6. 工具结果只是本地检索片段，最终回答仍需结合用户问题进行总结。";
```

**注入位置**：工具决策阶段（使用 `tool_choice: "auto"`）时作为 system message 追加。

## 5. 多轮调用控制

```typescript
// app/api/chat/route.ts

const MAX_TOOL_ROUNDS = 2;

for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
  // 1. 用 toolUseInstruction + tools 让 LLM 做决定
  const decision = await llm.chat.completions.create({
    messages: [...conversation, { role: "system", content: toolUseInstruction }],
    tools: toolDefinitions,
    tool_choice: "auto",
  });

  const toolCalls = decision.choices[0].message.tool_calls ?? [];

  // 2. 无工具调用 → 直接返回流式回复
  if (toolCalls.length === 0) {
    return new Response(await createTextStream(conversation));
  }

  // 3. 执行工具并将结果注入 conversation
  conversation.push(assistantMessage);
  for (const toolCall of toolCalls) {
    const result = await executeToolCall(toolCall, { sessionId });
    conversation.push({ role: "tool", tool_call_id: toolCall.id, content: result });
  }
}

// 超轮数后强制回答
conversation.push({ role: "system", content: "本地工具调用已达到最大轮次……" });
return new Response(await createTextStream(conversation));
```

## 6. 工具执行机制

### 6.1 参数校验

每个工具的执行器对必需参数做严格校验：
```typescript
function asRequiredString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}
```

### 6.2 结果格式化

工具结果通过 `safeJson` 序列化为 JSON 字符串返回给 LLM：

```json
{
  "ok": true,
  "message": "3 documents found",
  "data": [
    {
      "sourceType": "document",
      "id": "xxx",
      "title": "React useEffect 内存泄漏处理",
      "category": "React",
      "tags": ["useEffect", "memory-leak", "cleanup"],
      "problemSnippet": "...",
      "solutionSnippet": "...",
      "codeSnippet": "...",
      "updatedAt": 1717000000
    }
  ]
}
```

**统一字段**：所有工具结果都包含 `sourceType` 字段，便于 LLM 识别来源：
- `document` → 文档库
- `conversation` → 会话历史
- `uploadedFile` → 上传文件

### 6.3 文本截断

为防止工具结果太长占据过多 token，所有文本片段按类型做截断：
| 字段 | 截断上限 |
|------|:---:|
| `contentSnippet` | 900 字符 |
| `problemSnippet` | 500 字符 |
| `solutionSnippet` | 900 字符 |
| `codeSnippet` | 700 字符 |

## 7. 搜索算法（本地文本匹配）

工具使用**基于关键词的评分函数**，而非语义嵌入：

```typescript
function scoreText(query: string, text: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  return terms.reduce((score, term) => {
    if (!haystack.includes(term)) return score;
    return score + (haystack === term ? 3 : 1);  // 精确匹配权重更高
  }, 0);
}
```

这比语义搜索更适用于"关键词检索"场景（如搜索 API 名、错误信息）。

## 8. 上传文件内容提取

`search_uploaded_files` 工具需要从消息内容中解析上传的文件：

```typescript
function extractUploadedFiles(messages: Message[]) {
  // 匹配用户在消息中上传的文件格式：
  // `文件名`:
  // ```
  // 文件内容
  // ```
  const filePattern = /\`([^\`]+)\`:\n\`\`\`\n([\s\S]*?)\`\`\`/g;
  // ...
}
```

## 9. 边界与安全

| 场景 | 处理方式 |
|------|----------|
| arguments 非 JSON 格式 | 返回 `{ ok: false, message: "参数格式错误" }` |
| sessionId 缺失但工具需要 | 抛 Error → 返回 `{ ok: false, message: "..." }` |
| 工具不存在 | 返回 `{ ok: false, message: "Unknown tool" }` |
| SQLite 查询异常 | 被 DAO 层 try-catch，返回 `{ ok: false, message: "查询失败" }` |
| query 为空字符串 | `asRequiredString` 校验不通过，返回错误 |
| 无结果 | 返回 `{ ok: true, message: "no matching documents", data: [] }` |