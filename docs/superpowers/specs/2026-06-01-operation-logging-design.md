# 错误处理与操作日志设计

## 目标

为服务端 AI 调用和本地工具调用建立最小可用的操作日志闭环，便于排查 Ollama/DeepSeek fallback、工具调用失败、工具无结果、API 异常等问题，并为后续文件系统工具、终端命令工具和工作区系统提供审计基础。

## 范围

本设计覆盖第一期能力：

- 新增 SQLite 操作日志表。
- 新增 DAO 写入和基础查询能力。
- 记录本地工具调用成功、失败和无结果。
- 记录 LLM provider 调用、fallback 和失败。
- 新增最小后端查询接口。
- 更新 README 说明日志用途。

本次不做复杂前端日志中心，不记录完整 prompt，不记录完整工具结果。

## 当前上下文

当前系统已有：

- SQLite 本地数据库：`app/lib/db.ts`
- DAO 层：`app/lib/dao.ts`
- LLM provider fallback：`app/lib/llm/provider.ts`
- 工具注册与执行：`app/lib/tools/registry.ts`
- chat route 工具调用循环：`app/api/chat/route.ts`

现在服务端主要依赖 `console.info` / `console.error` 输出运行状态。问题是这些日志不可查询、不可关联会话，也不适合作为后续高权限工具的审计依据。

## 已确认拆分

第一期拆成 4 个阶段：

1. 数据库日志表。
2. 工具调用日志。
3. LLM provider 调用日志。
4. 最小查看入口。

## Phase 1.1：数据库日志表

新增 `operation_logs` 表，字段：

- `id TEXT PRIMARY KEY`
- `sessionId TEXT`
- `type TEXT NOT NULL`
- `operation TEXT NOT NULL`
- `status TEXT NOT NULL`
- `inputSummary TEXT`
- `outputSummary TEXT`
- `errorMessage TEXT`
- `durationMs INTEGER`
- `createdAt INTEGER NOT NULL`

字段含义：

- `type`：日志类型，第一期支持 `chat` / `tool` / `llm` / `api`。
- `operation`：具体操作名，例如 `chat tool decision`、`search_documents`、`chat stream`。
- `status`：`success` 或 `error`。
- `inputSummary`：输入摘要，只记录必要信息，例如工具 query 或 provider 名称，不记录完整 prompt。
- `outputSummary`：输出摘要，例如结果数量、最终 provider、fallback 状态。
- `errorMessage`：错误摘要。
- `durationMs`：操作耗时。

索引：

- `idx_operation_logs_session_created`：`sessionId, createdAt DESC`
- `idx_operation_logs_type_status`：`type, status`
- `idx_operation_logs_created`：`createdAt DESC`

新增 `OperationLogDAO`：

- `create(log: OperationLogInput): void`
- `getRecent(options): OperationLog[]`

`getRecent` 第一阶段支持：

- `sessionId?: string`
- `limit?: number`，默认 100，最大 200

## Phase 1.2：工具调用日志

记录本地工具调用：

- 工具名
- `sessionId`
- 参数摘要
- 成功/失败
- 返回结果数量或错误信息
- 耗时

推荐在工具执行边界记录，而不是散落到每个工具内部：

- `executeToolCall` 负责解析、执行、序列化工具结果。
- 日志也应尽量在这个边界完成。

输入摘要规则：

- 对 `query` 字段记录截断后的文本，例如最多 200 字。
- 不记录完整用户 prompt。
- 未知工具只记录工具名。

输出摘要规则：

- 成功时记录 `message` 和 `data` 数组长度，例如 `1 document found; results=1`。
- 失败时记录 `message`。
- 不记录完整 `data` 内容。

工具调用失败不改变现有行为，仍返回：

```ts
{ ok: false, message: string }
```

## Phase 1.3：LLM provider 调用日志

在 `runWithLlmFallback` 记录 LLM provider 调用：

- `operationName`
- 尝试的 provider：`ollama` / `deepseek`
- provider 成功或失败
- fallback 是否发生
- 错误摘要
- 耗时

建议记录两类日志：

- provider 单次尝试：`type = "llm"`，`operation = operationName`
- fallback 结果摘要：可通过 `outputSummary` 表达，例如 `provider=deepseek; fallback=true`

安全要求：

- 不记录 API key。
- 不记录完整 messages。
- 不记录完整 prompt。
- 错误信息只保留 SDK 错误摘要，必要时截断。

## Phase 1.4：最小查看入口

新增后端 API：

- `GET /api/operation-logs`

查询参数：

- `sessionId`：可选，按会话过滤。
- `limit`：可选，默认 100，最大 200。

响应：

```ts
{
  logs: OperationLog[];
}
```

第一期不做前端日志页面。原因：

- 当前最需要的是可追踪的后端日志基础。
- 前端展示会引入筛选、分页、样式和权限交互，容易扩大范围。
- 后续可以在 Workspace 或会话侧栏中增加“操作日志”面板。

## 错误处理原则

- 日志写入失败不能影响主流程。
- DAO 写入异常只允许 `console.warn`，不能让 chat/tool/LLM 请求失败。
- API 查询日志失败时返回 500。
- 日志内容必须是摘要，不允许保存敏感凭证或完整 prompt。

## 测试

新增或扩展测试覆盖：

- `OperationLogDAO.create` 能写入日志。
- `OperationLogDAO.getRecent` 默认返回最近日志。
- `OperationLogDAO.getRecent` 支持按 `sessionId` 过滤。
- `limit` 有默认值和最大值保护。
- 工具调用成功时写入 `tool` 日志。
- 工具调用失败时写入 `tool` 日志。
- LLM primary provider 失败并 fallback 时写入 `llm` 日志。
- 日志摘要不包含完整 prompt 或 API key。

最终验证命令：

```bash
npm test
npm run lint
npm run build
```

## README 更新

更新 README：

- 核心功能增加“操作日志”说明。
- 技术亮点中说明服务端记录 AI/provider/tool 运行摘要。
- 开发计划中将“错误处理 + 操作日志”标记为第一期完成后可勾选。

## 非目标

- 不做完整前端日志中心。
- 不做日志删除、导出、全文搜索。
- 不记录完整 prompt、完整消息或完整工具结果。
- 不实现文件系统工具、终端命令工具或网络搜索工具。
- 不引入外部日志服务。

## 验收标准

- SQLite 中存在 `operation_logs` 表和必要索引。
- 工具调用成功、失败、无结果都有日志。
- LLM provider 成功、失败、fallback 都有日志。
- 日志写入失败不影响主流程。
- `GET /api/operation-logs` 能查询最近日志。
- 日志不包含 API key 或完整 prompt。
- `npm test`、`npm run lint`、`npm run build` 通过。
