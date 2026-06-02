# AI-Code-Explainer 项目设计文档

> 版本：v1.1 · 最后更新：2026-06-01

---

## 0. 📚 详细技术方案索引

> 本项目包含一套按主题分开的**详细设计文档**，位于 `app/docs/` 目录下，覆盖 6 个核心技术主题：
>
> | # | 文档 | 主题 |
> |---|------|------|
> | 01 | [`01-llm-provider-architecture.md`](./01-llm-provider-architecture.md) | LLM Provider 架构 — 双层 Provider、优雅降级、统一错误体系 |
> | 02 | [`02-dual-rag-strategy.md`](./02-dual-rag-strategy.md) | 双层 RAG 策略 — 对话 RAG + 文件 RAG、MiniLM 嵌入、IndexedDB 缓存 |
> | 03 | [`03-tool-calling-system.md`](./03-tool-calling-system.md) | 本地工具调用系统 — Function Calling 注册-执行、多轮决策、指令注入 |
> | 04 | [`04-sqlite-storage-and-migration.md`](./04-sqlite-storage-and-migration.md) | SQLite 存储与数据迁移 — 三层存储、FTS5 全文检索、渐进式迁移 |
> | 05 | [`05-state-management-and-performance.md`](./05-state-management-and-performance.md) | 前端状态管理与性能优化 — TaskQueue、rAF 节流、虚拟化、memo |
> | 06 | [`06-knowledge-document-system.md`](./06-knowledge-document-system.md) | 知识文档系统 — AI 自动提取、分类管理、文档-对话双向关联 |

---

## 1. 项目概述

AI-Code-Explainer 是一个面向开发者的对话式 AI 辅助工具。用户可以在多轮对话中与本地 LLM（Ollama/DeepSeek）交互，上传代码文件、保存结构化开发文档，并通过语义检索回溯历史知识。

### 1.1 核心能力

| 能力 | 说明 |
|------|------|
| 多轮对话 | 支持上下文裁剪、流式输出、消息版本管理（regenerate） |
| 双 LLM Provider | 优先 Ollama（本地），不可用时自动 fallback DeepSeek |
| 文件上传 | 支持 .txt / .md 文件，自动索引用于 RAG 检索 |
| 文档保存 | 将对话内容 AI 自动提取为结构化文档（标题/分类/问题/方案/代码） |
| 语义搜索 | 浏览器端 MiniLM 嵌入 + IndexedDB 缓存，支持对话历史与文件内容的向量检索 |
| LLM Function Calling | 本地工具注册机制，让 LLM 能查询已保存的文档、会话历史、上传文件 |
| 历史压缩 | 长对话自动压缩为摘要以节省 token |
| 离线可用 | 依赖 SQLite 持久化，本地模型优先策略 |

### 1.2 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 16 (React 19) |
| 样式 | TailwindCSS v4 + CSS Modules |
| 数据库 | better-sqlite3（服务端持久化） |
| AI SDK | `ai` v6 + `@ai-sdk/openai` v3（提取功能） / `openai` 官方 SDK（聊天、压缩、标题） |
| 向量嵌入 | `@huggingface/transformers`（浏览器端 MiniLM-L6-v2） |
| 虚拟列表 | react-virtuoso |
| Markdown | react-markdown + react-syntax-highlighter |
| 构建 | Turbopack / TypeScript 6 |

---

## 2. 目录结构

```
app/
├── api/                          # API Routes（服务端）
│   ├── chat/route.ts             #   LLM 聊天流式接口
│   ├── compress/route.ts         #   对话历史压缩
│   ├── documents/
│   │   ├── route.ts              #   文档 CRUD（含全文搜索）
│   │   └── extract/route.ts      #   AI 提取文档结构
│   ├── sessions/route.ts         #   会话 CRUD + 消息管理 + 旧数据迁移
│   └── title/route.ts            #   LLM 生成会话标题
│
├── components/                   # 客户端 UI 组件
│   ├── CodeBlock.tsx             #   代码块渲染（语法高亮）
│   ├── FileUpload.tsx            #   文件拖拽/选择上传
│   ├── InputArea.tsx             #   输入区（含 token 估算、文件上传、保存文档入口）
│   ├── MessageItem.tsx           #   单条消息卡片
│   ├── MessageSearch.tsx         #   侧栏语义搜索
│   ├── SaveDocumentModal.tsx     #   保存文档弹窗（含 AI 提取按钮）
│   └── ThemeToggle.tsx           #   明暗主题切换
│
├── docs/                         # 文档展示页
│   ├── page.tsx                  #   文档列表 + 详情 + 全文搜索 + 内联编辑
│   └── docs.module.css
│
├── hooks/                        # 客户端状态管理
│   ├── useSession.ts             #   localStorage 版会话管理
│   ├── useSessionWithDB.ts      #   SQLite 版会话管理（含数据迁移）
│   ├── useSemanticSearch.ts      #   浏览器端语义搜索 hook
│   └── useTheme.ts              #   主题切换 hook
│
├── lib/                          # 服务端逻辑层
│   ├── dao.ts                    #   数据访问对象（SessionDAO / MessageDAO / DocumentDAO）
│   ├── db.ts                     #   SQLite 数据库初始化（schema 定义）
│   ├── env.ts                    #   环境变量工具
│   ├── storage.ts                #   前端 API 存储适配器（调用后端 API）
│   ├── migrate.ts                #   localStorage → SQLite 数据迁移
│   ├── taskQueue.ts              #   FIFO 任务队列（防竞态）
│   ├── conversationRag.ts        #   对话语义上下文检索
│   ├── fileChunkRag.ts           #   上传文件分块、嵌入、检索
│   ├── llm/                      #   LLM Provider 层
│   │   ├── config.ts             #     Provider 配置（Ollama / DeepSeek）
│   │   ├── provider.ts           #     带 fallback 的 LLM 调用
│   │   └── errors.ts            #     自定义错误类型
│   └── tools/                    #   Function Calling 工具注册
│       ├── registry.ts           #     工具定义与执行器
│       └── registry.test.ts      #     工具测试
│
├── types/                        # 类型声明
├── utils/
│   └── tokenEstimate.ts          # Token 估算工具
│
├── page.tsx                      # 主页面（对话页）
├── layout.tsx                    # 根布局（字体、主题初始化脚本）
└── globals.css                   # 全局样式 + 主题变量
```

---

## 3. 架构分层图

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (React 19)                        │
│                                                              │
│   useSessionWithDB  ←──  storage.ts (API Adapter)           │
│        ↓                     ↕ fetch                         │
│   useSemanticSearch ── IndexedDB ── transformers.js  │
│        ↓                                                   │
│   Components: Chat / InputArea / FileUpload / ...           │
│                                                              │
│   Docs: Document list / Detail / Search / Edit               │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP (Server Components / API Routes)
┌──────────────────────▼──────────────────────────────────────┐
│                  Next.js API Routes                          │
│                                                              │
│   /api/chat          → OpenAI SDK  → Ollama / DeepSeek       │
│   /api/compress      → OpenAI SDK  → Ollama / DeepSeek       │
│   /api/title         → OpenAI SDK  → Ollama / DeepSeek       │
│   /api/documents/extract → @ai-sdk/openai → DeepSeek         │
│   /api/documents     → DocumentDAO → better-sqlite3          │
│   /api/sessions      → SessionDAO / MessageDAO → SQLite       │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   SQLite (better-sqlite3)                     │
│                                                              │
│   tables: sessions / messages / documents                    │
│   path: ~/.ai-workspace/data.db                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 数据流：发送消息

```
用户输入 → InputArea.onSend()
  → useSessionWithDB.send()
    → 乐观更新 state (user msg + assistant placeholder)
    → storage.bulkCreateMessages() → POST /api/sessions
    → streamAssistant()
      → Conversation RAG (语义检索历史相关消息)
      → File RAG (检索上传文件 chunks)
      → trimContext() (保留最近 15 轮)
      → fetch POST /api/chat (stream)
      → rAF 节流逐段更新 UI
    → (首轮) generateTitle() → POST /api/title
```

### 3.2 数据流：保存文档

```
用户点击「保存为文档」→ SaveDocumentModal
  → "AI 自动提取" → POST /api/documents/extract
    → 拼接对话文本 → prompt → DeepSeek API → 返回 JSON
  → 填写/编辑表单 → "保存文档" → POST /api/documents (create)
  → DocumentDAO.create() → INSERT INTO documents
```

### 3.3 数据流：历史压缩

```
用户点击「压缩历史」→ useSessionWithDB.compressContext()
  → fetch POST /api/compress
    → runWithLlmFallback (Ollama → DeepSeek)
    → 返回结构化摘要
  → storage.bulkReplaceMessages() (删减已压缩历史)
  → storage.updateSession() (持久化 summary)
```

---

## 4. 存储设计

> **详细方案 → [`04-sqlite-storage-and-migration.md`](./04-sqlite-storage-and-migration.md)**：FTS5 全文检索机制、触发器同步、索引策略、三层存储选址、渐进式幂等迁移。

### 4.1 SQLite 数据库 (`~/.ai-workspace/data.db`)

```sql
-- 会话表
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  createdAt         INTEGER NOT NULL,
  updatedAt         INTEGER NOT NULL,
  pinned            INTEGER DEFAULT 0,
  summary           TEXT,              -- 压缩后的历史摘要
  titleGenerated    INTEGER DEFAULT 0, -- 是否已由 LLM 生成标题
  compressedUntil   INTEGER DEFAULT 0  -- 已压缩的消息数量
);

-- 消息表
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  sessionId       TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  createdAt       INTEGER NOT NULL,
  variants        TEXT,              -- JSON array: 多个 regenerate 版本
  activeVariant   INTEGER DEFAULT 0, -- 当前激活的版本索引
  FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 文档表
CREATE TABLE documents (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  category          TEXT,
  tags              TEXT,              -- JSON array
  problem           TEXT,
  solution          TEXT,
  code              TEXT,
  relatedSessionId  TEXT,
  createdAt         INTEGER NOT NULL,
  updatedAt         INTEGER NOT NULL,
  FOREIGN KEY (relatedSessionId) REFERENCES sessions(id) ON DELETE SET NULL
);
```

### 4.2 IndexedDB（浏览器端）

**数据库名**: `semantic-search-cache`
**存储对象**: `embeddings`

每条记录包含：
- `key`: `"{sessionId}:{messageId}"`
- `sessionId`, `messageId`
- `text`: 原始文本
- `embedding`: Float32Array 序列化为 number[]
- `isFileChunk?`: 标记是否为文件 chunk
- `fileName?`, `chunkIndex?`, `chunkTotal?`

### 4.3 localStorage

- `chat_sessions`：旧版存储（已废弃，通过迁移工具转为 SQLite）
- `chat_sessions_migrated_to_sqlite`：迁移标记
- `theme`：明暗主题偏好

---

## 5. LLM Provider 架构

> **详细方案 → [`01-llm-provider-architecture.md`](./01-llm-provider-architecture.md)**：三层错误体系（MissingFallbackProviderError / ProviderCallError）、各 API 的复用情况、边界场景处理。

### 5.1 配置

```
  环境变量                  默认值
  OLLAMA_BASE_URL      http://localhost:11434/v1
  OLLAMA_MODEL         qwen2.5-coder:7b
  DEEPSEEK_API_KEY     (无)
  DEEPSEEK_BASE_URL    https://api.deepseek.com
  DEEPSEEK_MODEL       deepseek-chat
```

### 5.2 调用链路

```
runWithLlmFallback(operation, { operationName })
  → try operation(config.primary)        # Ollama
  → 失败则 log warn + try fallback       # DeepSeek
  → 再次失败则 throw ProviderCallError
```

所有对话 API（chat/compress/title）共用此链路。

**例外**：`/api/documents/extract` 使用 `@ai-sdk/openai` v3 直接调用 DeepSeek，未走 fallback 机制。

### 5.3 Function Calling 工具

> **详细方案 → [`03-tool-calling-system.md`](./03-tool-calling-system.md)**：多轮调用控制、指令注入、参数校验、结果格式化、关键词评分搜索算法。

| 工具名 | 用途 | 作用域 |
|--------|------|--------|
| `search_documents` | 搜索已保存的文档库 | 全局 |
| `search_conversation` | 搜索当前会话历史消息 | 按 sessionId |
| `search_uploaded_files` | 搜索上传文件的内容片段 | 按 sessionId |

工具执行结果格式化为 JSON 返回给 LLM，LLM 据此总结回答。

---

## 6. 关键设计决策

### 6.1 为什么用两种 AI SDK？

| 用途 | SDK | 理由 |
|------|-----|------|
| 聊天/压缩/标题 | `openai` 官方 SDK | 原生支持 streaming、function calling，兼容 OpenAI API |
| 文档提取 | `@ai-sdk/openai` v3 | 用于 `generateText` 一次性调用，需注意用 `.chat()` 而非默认的 `.responses()` |

### 6.2 为什么会话存 localStorage 而文档存 SQLite？

项目历经两个存储阶段：

- **阶段 1**：所有数据存 localStorage（零依赖，快速原型）
- **阶段 2**：引入 SQLite 持久化文档，会话通过 `migrate.ts` 逐步迁移

目前 `useSession.ts`（localStorage）和 `useSessionWithDB.ts`（SQLite）并存，页面通过切换 hook 选择存储后端。

### 6.3 Token 估算

使用基于字符计数的启发式算法，无需加载 tokenizer 模型：
- CJK 字符：0.6 token/字
- 其他字符：0.3 token/字
- 每条消息额外 +4 token 的角色/分隔开销

在 DeepSeek-chat 64K 上下文中，警告线 50K，危险线 60K。

### 6.4 RAG 策略

> **详细方案 → [`02-dual-rag-strategy.md`](./02-dual-rag-strategy.md)**：触发条件、相似度阈值、缓存一致性、降级策略、分块策略完整说明。

**对话 RAG**：在发送消息前，用 MiniLM 对全量历史做语义检索，找到与当前问题最相关的 3 条历史消息拼入 system prompt。

**文件 RAG**：上传文件时按行分块（20 行/块，3 行重叠），生成嵌入向量缓存到 IndexedDB。查询时检索最相关 chunks 拼入 context。

---

## 7. API 接口一览

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/chat` | LLM 流式聊天 |
| POST | `/api/compress` | 对话历史压缩 |
| POST | `/api/title` | LLM 生成会话标题 |
| POST | `/api/documents/extract` | AI 提取文档结构 |
| GET | `/api/documents` | 获取文档列表 / 按 id 查 / 按 q 全文搜索 |
| POST | `/api/documents` | 创建/更新/删除文档（action 区分） |
| GET | `/api/sessions` | 获取会话列表 |
| POST | `/api/sessions` | 会话/消息 CRUD + 批量操作 + 旧数据迁移 |

---

## 8. 组件树与状态管理

```
<RootLayout>
  <Home>                              ← useSession / useSessionWithDB
    ├─ <header> (顶部导航)
    │   ├─ <Link to="/">
    │   ├─ <Link to="/docs">
    │   └─ <ThemeToggle>              ← useTheme
    ├─ <aside> (侧栏)
    │   ├─ 按钮: 新建会话
    │   ├─ 搜索输入框
    │   ├─ <MessageSearch>            ← useSemanticSearch
    │   └─ <SessionItem> (列表, memo)
    └─ <main>
        ├─ <MessageItem>              ← memo, 含 variants 切换
        └─ <InputArea>
            ├─ <FileUpload>           ← 文件拖拽/选择
            ├─ token 估算显示
            ├─ 按钮: 压缩历史
            ├─ 按钮: 保存文档
            └─ <SaveDocumentModal>    ← 提取 + 保存表单

<DocsPage>                            ← 独立路由 /docs
  ├─ <header> (顶部导航)
  ├─ <aside> (文档列表/搜索/分类)
  └─ <main> (文档详情)
      └─ <SaveDocumentModal> (编辑模式)
```

### 状态管理模式

> **详细方案 → [`05-state-management-and-performance.md`](./05-state-management-and-performance.md)**：TaskQueue 实现、rAF 节流逻辑、虚拟化阈值、memo 比较函数等完整内容。

前端状态采用 **React useState + useCallback + refs** 的方式管理，未使用外部状态库：

- **useSession.ts / useSessionWithDB.ts**：中心化的 hook，管理会话列表、活跃会话、消息数组、streaming 状态
- **TaskQueue**：保证 send / regenerate / compress 串行执行，避免竞态（如 streaming 进行中触发压缩导致消息切片错位）
- **sessionsRef / messagesRef**：用 ref 跟踪最新值，避免闭包过期问题

---

## 9. 数据迁移

从 localStorage 到 SQLite 的迁移流程：

1. 首次加载 → 检测 `chat_sessions_migrated_to_sqlite` 标记
2. 未迁移 → 读取 `chat_sessions` → POST `/api/sessions` (migrateLegacySessions)
3. 服务端逐条写入 sessions + messages 表，同名 id 跳过
4. 写入标记 `chat_sessions_migrated_to_sqlite = true`
5. 后续加载直接从 SQLite 读取

---

## 10. 已知限制与改进方向

| 限制 | 说明 | 可能改进 |
|------|------|----------|
| 双存储后端并存 | `useSession.ts`（localStorage）和 `useSessionWithDB.ts`（SQLite）并存，代码有冗余 | 统一为 SQLite 后端 |
| 提取功能无 fallback | `/api/documents/extract` 硬编码 DeepSeek，不走 LLM Provider fallback | 复用 `runWithLlmFallback` |
| 无用户认证 | 所有数据单机存储，无法多设备同步 | 可选：加用户系统 + 云端同步 |
| 嵌入模型在浏览器端 | MiniLM 模型约 23MB，首次加载需下载 | 可考虑 Service Worker 缓存或用服务端嵌入 |
| 文档搜索仅在服务端 | 全文搜索依赖 SQLite LIKE | 可引入 FTS5 全文索引 |
