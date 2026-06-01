# AI 工作平台

基于 Next.js 16 + React 19 + Vercel AI SDK / OpenAI-compatible SDK 构建的本地 AI 对话工作平台，支持多会话管理、文件 RAG、语义搜索、上下文压缩和**开发问题文档系统**。模型默认优先接入本地 [Ollama](https://ollama.com/)（OpenAI-compatible 接口），并可在本地服务不可用时 fallback 到 [DeepSeek](https://platform.deepseek.com/)。

## 核心功能

### 1. 智能对话
- **流式响应**：服务端通过 OpenAI-compatible 接口优先调用本地 Ollama，失败时可 fallback 到 DeepSeek，实时流式输出
- **多会话管理**：支持创建、切换、重命名、删除会话，会话置顶
- **自动标题**：首轮对话结束后用 LLM 自动生成简短会话标题
- **上下文压缩**：手动压缩长对话历史，保持上下文连贯性
- **多轮对话**：支持重新生成回答、多版本答案切换

### 2. 文件 RAG（检索增强生成）
- **文件上传**：支持 `.txt` / `.md` / `.mdx` 文件（单文件 ≤ 512KB）
- **智能分块**：按行切分（20 行窗口、3 行重叠），保持语义连贯
- **语义检索**：基于 `Xenova/all-MiniLM-L6-v2` 模型的向量检索
- **自动注入**：查询时自动检索相关文件片段并注入上下文

### 3. 对话语义搜索
- **实时索引**：对话消息自动生成向量嵌入并持久化到 IndexedDB
- **语义匹配**：支持模糊语义搜索，快速定位历史对话
- **一键跳转**：点击搜索结果自动滚动到对应消息（支持虚拟化列表）

### 4. 开发问题文档系统
- **AI 自动提取**：从对话中自动提取标题、分类、标签、问题、解决方案、代码
- **知识沉淀**：将开发问题归档为结构化文档，支持分类管理
- **快速检索**：按分类浏览，支持全文搜索（SQLite FTS5，覆盖标题/标签/问题/解决方案/代码正文）
- **关联对话**：文档与原始对话双向关联，可追溯上下文

**工作流程**：
```
对话解决问题 → 点击"保存为文档" → AI 自动提取 → 编辑确认 → 保存到 SQLite → /docs 页面查看
```

### 5. 本地数据持久化
- **SQLite 存储**：会话、消息、文档存储在 `~/.ai-workspace/data.db`
- **自动迁移**：首次启动时自动把旧版 localStorage 会话迁移到 SQLite，并以横幅提示进度
- **IndexedDB 缓存**：向量嵌入本地缓存，切换会话无需重新计算
- **数据安全**：所有数据存储在本地，不上传云端

### 6. 性能优化
- **虚拟化渲染**：超过 30 条消息自动启用 `react-virtuoso` 虚拟滚动
- **模型缓存**：嵌入模型单例复用，避免重复加载
- **流式处理**：实时显示 AI 回复，无需等待完整响应
- **串行任务队列**：嵌入索引等后台任务通过 FIFO 队列串行执行，避免并发抖动

## 技术栈

- **框架**：Next.js 16 (App Router) + React 19
- **AI 调用**：OpenAI-compatible SDK（Ollama 本地优先，DeepSeek fallback）
- **对话模型**：默认 `qwen2.5-coder:7b`（Ollama）；fallback 为 `deepseek-chat`
- **嵌入模型**：`Xenova/all-MiniLM-L6-v2`（浏览器端 `@huggingface/transformers` 运行）
- **UI 组件**：React Markdown + React Syntax Highlighter
- **虚拟化**：react-virtuoso
- **数据库**：better-sqlite3
- **样式**：Tailwind CSS 4 + CSS Modules

## 项目结构

```
app/
├── api/
│   ├── chat/              # 对话 API（流式响应）
│   ├── compress/          # 上下文压缩 API
│   ├── title/             # 会话标题生成 API
│   ├── sessions/          # 会话管理 API（SQLite）
│   └── documents/         # 文档管理 API
│       ├── route.ts       # 文档 CRUD
│       └── extract/       # AI 自动提取
├── components/
│   ├── CodeBlock.tsx           # 代码块渲染 + 语法高亮 + 复制
│   ├── FileUpload.tsx          # 文件上传组件
│   ├── InputArea.tsx           # 输入框 + 文件管理 + 保存文档按钮
│   ├── MessageItem.tsx         # 消息渲染（Markdown + 代码高亮）
│   ├── MessageSearch.tsx       # 语义搜索组件
│   ├── SaveDocumentModal.tsx   # 保存文档弹窗
│   └── ThemeToggle.tsx         # 主题切换
├── hooks/
│   ├── useSessionWithDB.ts     # 会话管理 + 对话逻辑（SQLite 持久化）
│   ├── useSemanticSearch.ts    # 语义搜索 hook
│   └── useTheme.ts             # 明暗主题 hook
├── lib/
│   ├── db.ts                   # SQLite 数据库初始化
│   ├── dao.ts                  # 数据访问层（DAO）
│   ├── storage.ts              # 客户端存储适配器
│   ├── migrate.ts              # localStorage → SQLite 迁移
│   ├── env.ts                  # 环境变量工具
│   ├── llm/                    # Ollama 本地优先 + DeepSeek fallback provider
│   ├── taskQueue.ts            # FIFO 任务队列
│   ├── fileChunkRag.ts         # 文件 RAG 实现
│   └── conversationRag.ts      # 对话历史 RAG
├── utils/
│   └── tokenEstimate.ts        # token 数启发式估算
├── docs/                       # 文档管理页面
│   ├── page.tsx
│   └── docs.module.css
└── page.tsx                    # 主页面
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

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

### 4. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看应用。

### 5. 构建生产版本

```bash
npm run build
npm start
```

### 可用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm start` | 启动生产服务器 |
| `npm run lint` | 运行 ESLint |
| `npm test` | 运行单元测试 |

## 使用指南

### 基础对话
1. 在主页面输入问题，按 Enter 发送
2. 支持 Shift+Enter 换行
3. 点击"重新生成"可以获得不同的回答
4. 多个版本的回答可以通过左右箭头切换
5. 首轮对话结束后会自动生成会话标题

### 文件上传
1. 点击输入框上方的文件上传区域
2. 支持拖拽或点击选择 `.txt` / `.md` / `.mdx` 文件
3. 上传后会自动索引，对话时自动检索相关内容

### 保存为文档
1. 对话解决问题后，点击输入框上方的"📝 保存为文档"
2. 点击"🤖 AI 自动提取"让 AI 自动整理文档结构
3. 编辑标题、分类、标签、问题描述、解决方案
4. 点击"保存文档"
5. 在 [/docs](http://localhost:3000/docs) 页面查看所有文档，选中文档后可点击"✏️ 编辑"修改内容

### 语义搜索
1. 在侧边栏的搜索框输入关键词
2. 支持模糊语义匹配，不需要精确匹配
3. 点击搜索结果自动跳转到对应消息

### 上下文压缩
1. 当对话历史过长时，点击"压缩历史"
2. 系统会将早期对话压缩成摘要
3. 保留最近 3 轮完整对话 + 摘要

## 核心特性说明

### 文件 RAG 工作流程

1. **上传文件**：拖拽或点击上传 `.txt` / `.md` / `.mdx` 文件
2. **自动索引**：文件内容按行切分成 chunk（20 行窗口、3 行重叠），生成向量嵌入并存储到 IndexedDB
3. **智能检索**：发送消息时，自动检索与问题相关的文件片段（Top-3，相似度 ≥ 0.2）
4. **上下文注入**：检索结果作为 system 消息注入到 API 请求中

### 对话 RAG 工作流程

1. **自动索引**：每条对话消息自动生成向量嵌入
2. **触发条件**：对话历史超过 4 条消息时启用
3. **语义检索**：根据当前问题检索最相关的历史消息（Top-3，相似度 ≥ 0.25）
4. **上下文增强**：相关历史消息作为额外上下文注入

### 文档系统工作流程

1. **对话解决问题**：通过 AI 对话解决开发问题
2. **保存触发**：点击"保存为文档"按钮
3. **AI 提取**：调用当前配置的对话模型自动提取结构化信息
   - 标题：问题的简短概括（15 字以内）
   - 分类：技术栈分类（React / Next.js / TypeScript / JavaScript / CSS / 性能优化 / Bug修复 / 工具配置 / 其他）
   - 标签：3-5 个关键词
   - 问题描述：详细的问题说明
   - 解决方案：具体的解决步骤
   - 代码示例：相关代码片段
4. **用户编辑**：可以修改 AI 提取的内容
5. **持久化存储**：保存到 SQLite documents 表
6. **分类浏览与检索**：在 /docs 页面按分类查看，并通过 FTS5 全文搜索（含正文）快速定位

### 上下文压缩

当对话历史过长时，可手动触发压缩：
- 保留最近 3 轮对话（6 条消息）
- 将更早的消息通过当前配置的对话模型总结成摘要（如已有旧摘要会合并去重）
- 摘要作为 system 消息保留在上下文中
- 正常请求最多携带最近 15 轮对话（30 条消息）作为上下文

## 技术亮点

### 1. 本地优先架构
- **SQLite 存储**：所有结构化数据（会话、消息、文档）存储在本地
- **IndexedDB 缓存**：向量嵌入本地缓存，离线可用
- **隐私保护**：数据不上传云端，完全本地化

### 2. 客户端嵌入模型
- **模型**：`Xenova/all-MiniLM-L6-v2`（量化版本）
- **运行环境**：浏览器端通过 `@huggingface/transformers` 运行
- **性能优化**：模型单例复用，首次加载后缓存复用
- **应用场景**：文件 RAG、对话 RAG、语义搜索

### 3. AI 自动化
- **文档提取**：从对话中自动提取结构化文档
- **标题生成**：首轮对话后自动为会话生成简短标题
- **上下文压缩**：自动总结历史对话

### 4. 工程实践
- **数据库设计**：规范化的 schema 设计，支持外键约束
- **API 设计**：RESTful API + 统一的错误处理（本地模型不可用且 fallback 未配置时返回 503）
- **组件化**：高度模块化的 React 组件
- **类型安全**：完整的 TypeScript 类型定义

## 数据存储

### SQLite（`~/.ai-workspace/data.db`）
- **sessions 表**：会话元数据（标题、创建/更新时间、置顶状态、摘要、标题是否已生成、压缩位点）
- **messages 表**：对话消息（角色、内容、变体版本）
- **documents 表**：开发问题文档（标题、分类、标签、问题、解决方案、代码）
- **documents_fts**：文档全文检索的 FTS5 虚拟表，由触发器与 documents 表自动同步

### IndexedDB（`semantic-search-cache`）
- **对话消息嵌入**：`sessionId:messageId`
- **文件 chunk 嵌入**：`sessionId:file:filename:chunkIndex`

### localStorage（兼容旧版本）
- **ai-sessions**：旧版会话数据，首次启动时自动迁移到 SQLite

## 开发计划

### 已完成 ✅
- [x] 多会话管理
- [x] 文件 RAG
- [x] 对话语义搜索
- [x] 上下文压缩
- [x] 虚拟化渲染
- [x] SQLite 本地存储 + 自动迁移（useSessionWithDB）
- [x] 开发问题文档系统
- [x] LLM 自动会话标题
- [x] 文档编辑功能
- [x] 文档全文搜索（SQLite FTS5）

### 规划中 📋
- [ ] 工具调用（Tool Use）
  - [ ] 文件系统操作
  - [ ] 终端命令执行
  - [ ] 网络搜索集成
- [ ] 本地模型集成（Ollama）
- [ ] 工作区（Workspace）系统
- [ ] 错误处理 + 操作日志

### 探索中 💡
- [ ] Electron 桌面应用
- [ ] 代码仓库 RAG
- [ ] 浏览器历史集成
- [ ] 多模态支持（图片理解 + 生成）

## 贡献指南

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT
