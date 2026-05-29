# AI 工作平台

基于 Next.js 16 + React 19 + Vercel AI SDK 构建的本地 AI 对话工作平台，支持多会话管理、文件 RAG、语义搜索和上下文压缩。

## 核心功能

### 1. 智能对话
- **流式响应**：基于 Vercel AI SDK 的实时流式输出
- **多会话管理**：支持创建、切换、重命名、删除会话，会话置顶
- **上下文压缩**：自动压缩长对话历史，保持上下文连贯性
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

### 4. 性能优化
- **虚拟化渲染**：超过 30 条消息自动启用 `react-virtuoso` 虚拟滚动
- **模型缓存**：嵌入模型单例复用，避免重复加载
- **IndexedDB 持久化**：向量嵌入本地缓存，切换会话无需重新计算

## 技术栈

- **框架**：Next.js 16 (App Router) + React 19
- **AI SDK**：Vercel AI SDK + OpenAI API
- **嵌入模型**：Xenova/all-MiniLM-L6-v2 (客户端运行)
- **UI 组件**：React Markdown + React Syntax Highlighter
- **虚拟化**：react-virtuoso
- **样式**：Tailwind CSS 4 + CSS Modules

## 项目结构

```
app/
├── api/
│   ├── chat/          # 对话 API（流式响应）
│   ├── compress/      # 上下文压缩 API
│   └── title/         # 会话标题生成 API
├── components/
│   ├── FileUpload.tsx      # 文件上传组件
│   ├── InputArea.tsx       # 输入框 + 文件管理
│   ├── MessageItem.tsx     # 消息渲染（支持代码高亮）
│   ├── MessageSearch.tsx   # 语义搜索组件
│   └── ThemeToggle.tsx     # 主题切换
├── hooks/
│   ├── useSession.ts       # 会话管理 + 对话逻辑
│   └── useSemanticSearch.ts # 语义搜索 hook
├── lib/
│   ├── fileChunkRag.ts     # 文件 RAG 实现
│   ├── conversationRag.ts  # 对话历史 RAG
│   └── compressor.ts       # 上下文压缩
└── page.tsx                # 主页面
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.env.local` 文件：

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.openai.com/v1  # 可选，自定义 API 端点
```

### 3. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看应用。

### 4. 构建生产版本

```bash
npm run build
npm start
```

## 核心特性说明

### 文件 RAG 工作流程

1. **上传文件**：拖拽或点击上传 `.txt` / `.md` 文件
2. **自动索引**：文件内容按行切分成 chunk，生成向量嵌入并存储到 IndexedDB
3. **智能检索**：发送消息时，自动检索与问题相关的文件片段（Top-3，相似度 ≥ 0.2）
4. **上下文注入**：检索结果作为 system 消息注入到 API 请求中

### 对话 RAG 工作流程

1. **自动索引**：每条对话消息自动生成向量嵌入
2. **触发条件**：对话历史超过 4 条消息时启用
3. **语义检索**：根据当前问题检索最相关的历史消息（Top-3，相似度 ≥ 0.25）
4. **上下文增强**：相关历史消息作为额外上下文注入

### 上下文压缩

当对话历史过长时，可手动触发压缩：
- 保留最近 N 条消息
- 将更早的消息通过 AI 总结成摘要
- 摘要作为 system 消息保留在上下文中

## 数据存储

- **会话数据**：localStorage（`ai-sessions`）
- **向量嵌入**：IndexedDB（`semantic-search-cache`）
  - 对话消息嵌入：`sessionId:messageId`
  - 文件 chunk 嵌入：`sessionId:file:filename:chunkIndex`

## 开发计划

### 短期（已完成）
- [x] 多会话管理
- [x] 文件 RAG
- [x] 对话语义搜索
- [x] 上下文压缩
- [x] 虚拟化渲染

### 中期（规划中）
- [ ] 本地数据持久化（SQLite）
- [ ] 本地模型集成（Ollama）
- [ ] 工具调用（文件系统、终端命令）
- [ ] 工作区（Workspace）系统
- [ ] 开发问题文档系统

### 长期（探索中）
- [ ] Electron 桌面应用
- [ ] 代码仓库 RAG
- [ ] 浏览器历史集成
- [ ] 多模态支持（图片理解 + 生成）

## 贡献指南

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT
