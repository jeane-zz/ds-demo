# 知识文档系统方案

> 关键词：AI 自动提取 · 结构化沉淀 · 分类管理 · 全文检索 · 文档-对话双向关联

---

## 1. 问题与目标

开发者在日常工作中会遇到大量问题，解决后往往就忘了。下次遇到类似问题又要重新搜索或问 AI。需要一个**知识沉淀系统**，让对话中的技术方案能自动提取为结构化文档并被检索复用。

目标：
1. 从对话中 **AI 自动提取**结构化信息（标题、分类、标签、问题、方案、代码）
2. 用户可**编辑确认**后再保存
3. 支持**分类浏览**和**全文检索**
4. 文档与原始对话**双向关联**
5. 可在后续对话中通过 Tool Calling 直接检索

## 2. 数据模型

```typescript
interface Document {
  id: string;                // UUID
  title: string;             // 15 字以内的问题概括
  category: string;          // 技术分类
  tags: string[];            // 3-5 个关键词
  problem: string;           // 问题详细描述
  solution: string;          // 解决方案步骤
  code: string;              // 代码示例
  relatedSessionId: string;  // 关联的对话 ID
  createdAt: number;         // 创建时间戳
  updatedAt: number;         // 更新时间戳
}
```

## 3. 工作流

```
┌─────────────────────────────────────────────────────────────────┐
│                      对话界面                                     │
│                                                                 │
│  [用户] 我需要修复 React useEffect 的内存泄漏                     │
│  [AI]   可以通过在 useEffect 中返回清理函数……                     │
│  [AI]   ```javascript                                           │
│         useEffect(() => {                                        │
│           const timer = setInterval(...);                       │
│           return () => clearInterval(timer);                    │
│         }, []);                                                  │
│         ```                                                      │
│                                                                 │
│  ┌──────────────┐                                              │
│  │ 📝 保存为文档 │  ← 用户点击                                │
│  └──────┬───────┘                                              │
└─────────┼───────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SaveDocumentModal                             │
│                                                                 │
│  ┌──────────────────────────┐                                   │
│  │ 🤖 AI 自动提取            │  ← POST /api/documents/extract  │
│  └──────────────────────────┘                                   │
│                                                                 │
│  标题: [React useEffect 内存泄漏处理]                          │
│  分类: [React] [Tags: #useEffect #内存泄漏 #清理函数]          │
│  问题: [在 React 组件中使用 setInterval 导致内存泄漏……]        │
│  方案: [在 useEffect 中返回清理函数来清除定时器……]             │
│  代码: [```javascript useEffect(() => { ... })``` ]            │
│                                                                 │
│  ┌──────────────┐                                              │
│  │ 💾 保存文档   │  ← POST /api/documents (action: create)     │
│  └──────────────┘                                              │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SQLite documents 表                            │
│                                                                 │
│  ├── After INSERT 触发器 → 自动写入 documents_fts (FTS5)       │
│  ├── 后续对话可通过 search_documents 工具查询                  │
│  └── 可在 /docs 页面分类浏览 + 全文搜索                        │
└─────────────────────────────────────────────────────────────────┘
```

## 4. AI 自动提取

### 4.1 Prompt 设计

```typescript
// app/api/documents/extract/route.ts

const prompt = `分析以下开发问题对话，提取结构化文档。

对话内容：
${conversationText}

要求：
1. title: 用一句话概括问题（15字以内）
2. category: 技术分类（从以下选择：React / Next.js / TypeScript / JavaScript / CSS / 性能优化 / Bug修复 / 工具配置 / 其他）
3. tags: 3-5个关键词标签（数组格式）
4. problem: 问题的详细描述（保留关键信息）
5. solution: 解决方案的详细步骤（保留代码和关键操作）
6. code: 提取所有代码块，用 \`\`\` 包裹

输出严格的 JSON 格式，不要有任何其他文字：
{
  "title": "...",
  "category": "...",
  "tags": ["...", "..."],
  "problem": "...",
  "solution": "...",
  "code": "..."
}`;
```

### 4.2 输出解析

LLM 返回的文本可能有额外说明文字，需要做容错解析：

```typescript
let extracted;
try {
  extracted = JSON.parse(text);  // 直接解析
} catch {
  // 容错：从文本中提取第一个 {} 结构
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    extracted = JSON.parse(jsonMatch[0]);
  } else {
    throw new Error('Failed to parse AI response');
  }
}
```

### 4.3 temperature 设置

提取任务使用 `temperature: 0.3`，比对话的默认温度更低，确保输出格式稳定。

## 5. 文档管理页面（/docs）

### 5.1 布局

```
┌─────────────────────────────────────────────────────────────────┐
│  💬 对话        📚 文档                                         │
├──────────────┬──────────────────────────────────────────────────┤
│ 🔍 搜索文档… │  [React useEffect 内存泄漏处理]                      │
│              │  ✏️ 编辑  🗑️ 删除                                 │
│ 📁 React (3) │                                                  │
│  ├─ 标题1    │  React ─ #useEffect ─ #内存泄漏 ─ 2026-01-15       │
│  ├─ 标题2    │                                                  │
│  └─ 标题3    │  🔍 问题描述                                      │
│              │  在 React 组件中使用 setInterval...                 │
│ 📁 CSS (1)   │                                                  │
│  └─ 标题4    │  ✅ 解决方案                                      │
│              │  在 useEffect 中返回清理函数...                    │
│ 📁 TypeScript│                                                  │
│  └─ 标题5    │  💻 代码示例                                      │
│              │  ```javascript useEffect( ()=>{} )```            │
├──────────────┤                                                  │
│ 未分类 (2)   │  🔗 查看原始对话                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

### 5.2 全文搜索

搜索实现：前端发 `GET /api/documents?q=关键词` → 服务端 DAO.search() → FTS5 全文索引 → 按 BM25 相关度排序。

**前端防抖**：300ms 防抖，避免每次按键都发请求：

```typescript
const handleSearchChange = (value: string) => {
  setSearchQuery(value);
  if (debounceRef.current) clearTimeout(debounceRef.current);

  const trimmed = value.trim();
  if (!trimmed) {
    setSearchResults(null);
    return;
  }

  debounceRef.current = setTimeout(async () => {
    const res = await fetch(`/api/documents?q=${encodeURIComponent(trimmed)}`);
    const data = await res.json();
    setSearchResults(data);
  }, 300);
};
```

### 5.3 内联编辑

点击"编辑"打开 `SaveDocumentModal`（复用创建时的模态框），编辑完成后调用 `POST /api/documents (action: update)`。

## 6. 文档-对话双向关联

### 6.1 文档指向对话

```typescript
interface Document {
  relatedSessionId: string;  // 来源对话的 sessionId
}
```

在文档详情页底部显示：`🔗 查看原始对话`，链接到 `/?session={relatedSessionId}`。

### 6.2 对话指向文档（通过 Tool Calling）

在对话中，LLM 可以通过 `search_documents` 工具检索文档库：

```
用户：之前我们讨论的 React 内存泄漏方案是什么？
    ↓ 触发 search_documents(query: "React 内存泄漏")
    ↓ 返回匹配的文档
    ↓ LLM 总结："之前在 {日期} 讨论过，方案是..."
```

## 7. 分类管理

### 7.1 分类选择列表（AI 提取时）

```typescript
const CATEGORIES = [
  "React",
  "Next.js",
  "TypeScript",
  "JavaScript",
  "CSS",
  "性能优化",
  "Bug修复",
  "工具配置",
  "其他",
];
```

### 7.2 分类浏览

/docs 页面按分类分组显示：

```typescript
// 从所有文档中提取分类列表
const categories = [...new Set(documents.map(d => d.category).filter(Boolean))];

// 按分类分组
const groupedDocs = categories.reduce((acc, cat) => {
  acc[cat] = displayDocs.filter(d => d.category === cat);
  return acc;
}, {} as Record<string, Document[]>);
```

## 8. 已知限制

| 限制 | 说明 |
|------|------|
| 提取不走 fallback | `/api/documents/extract` 硬编码使用 `@ai-sdk/openai` 调用 DeepSeek，未复用 `runWithLlmFallback` |
| 无批量操作 | 不支持批量删除/导出文档 |
| tags 不索引到 FTS5 | tags 虽在 FTS5 的列中，但排序只依赖单独的 tag 显示 |
| 文档不可关联多个对话 | 一个文档只能关联一个 session，不支持多方来源合并 |