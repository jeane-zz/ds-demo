# 双层 RAG（检索增强生成）方案

> 关键词：对话 RAG · 文件 RAG · MiniLM 嵌入 · IndexedDB 缓存 · 优雅降级

---

## 1. 问题与目标

纯 LLM 对话有两个局限：
1. **上下文窗口受限**：历史对话太长会超过 token 限制或被裁剪
2. **静态知识**：LLM 不知道用户之前说过什么、上传过什么文件

目标是在发送给 LLM 的请求中**自动注入相关的历史上下文**，让回答更连贯准确。

## 2. 总体策略

采用**两种 RAG 策略**并行工作：

```
用户输入
    │
    ├── 对话 RAG ──→ 从全量历史中检索与当前问题最相关的历史消息
    │                    → 包装为 system prompt 注入
    │
    └── 文件 RAG ──→ 从上传文件中检索相关片段
                         → 包装为 system prompt 注入
```

两种 RAG 都使用同一个嵌入模型和 IndexedDB 存储，但检索目标和触发条件不同。

## 3. 嵌入基础设施（共享层）

### 3.1 模型

- **模型**：`Xenova/all-MiniLM-L6-v2`（量化版）
- **运行环境**：浏览器端，通过 `@huggingface/transformers` 运行
- **向量维度**：384 维
- **单例复用**：`pipelineCache` 全局缓存，首次加载后复用

```typescript
// app/lib/fileChunkRag.ts 中的单例模式
let pipelineCache: unknown = null;

export async function getPipeline() {
  if (pipelineCache) return pipelineCache;
  const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: true,
  });
  pipelineCache = pipe;
  return pipe;
}
```

### 3.2 存储：IndexedDB

**数据库** `semantic-search-cache` / **存储对象** `embeddings`

```typescript
interface EmbeddingRecord {
  key: string;                    // "{sessionId}:{messageId}"
  sessionId: string;
  messageId: string;
  text: string;                   // 原始文本
  embedding: number[];            // Float32Array 序列化
  updatedAt: number;
  isFileChunk?: boolean;          // 区分消息与文件 chunk
  fileName?: string;
  chunkIndex?: number;
  chunkTotal?: number;
}
```

**关键设计**：消息嵌入和文件 chunk 嵌入**共用一个数据表**，通过 `isFileChunk` 字段区分。

## 4. 对话 RAG（Conversation RAG）

### 4.1 触发条件

历史消息数量 > **4 条**（排除 system 消息后）

### 4.2 流程

```
用户输入问题
    → 从 IndexedDB 读取当前 session 的所有嵌入
    → 用 MiniLM 生成问题的嵌入向量
    → 遍历所有历史消息，计算余弦相似度
    → 过滤得分 >= 0.25 的消息
    → 取 Top-3，维持原始时间顺序
    → 包装为 system prompt：
       "以下是对话历史中与当前问题相关的上下文..."
```

### 4.3 注入位置

最终发送给 /api/chat 的消息数组：

```
[
  system prompt（原始）,
  { role: "system", content: "对话历史相关上下文..." },  // ← 对话 RAG 注入
  { role: "system", content: "文件相关片段..." },       // ← 文件 RAG 注入
  summary 摘要（如果有上下文压缩）,
  recent 最近对话（最多 15 轮）,
]
```

### 4.4 降级策略

RAG 检索失败不阻断主流程：
```typescript
try {
  ragContext = await retrieveRelevantContext(sessionId, query, history);
} catch (e) {
  console.warn("对话 RAG 检索出错，跳过:", e);
  // ragContext 保持空数组，后续消息数组不受影响
}
```

## 5. 文件 RAG（File RAG）

### 5.1 文件分块策略

```typescript
// app/lib/fileChunkRag.ts
export function chunkTextFile(
  fileName: string,
  content: string,
  linesPerChunk = 20,
  overlapLines = 3
): FileChunk[] {
  // 按行切分，20 行/块，3 行重叠
  // 避免在句子中间切断
}
```

分块示意：
```
┌──────────────┐  ← 块 0（行 0-19）
├──────────────┤
│ overlapped   │  ← 行 17-19（与块 0 重叠的 3 行）
├──────────────┤  ← 块 1（行 17-36）
├──────────────┤
│ overlapped   │  ← 行 33-36
└──────────────┘  ← 块 2（行 33-52）
```

### 5.2 索引流程

```
用户上传文件 / 消息中包含文件内容
    → 按行分块（20行/块，3行重叠）
    → 为每个 chunk 生成 384 维嵌入向量
    → 先清除该文件的旧缓存（IndexedDB）
    → 写入新嵌入
    → 标记 isFileChunk = true
```

**异步索引**：文件内容的索引不阻塞对话回复，通过 `Promise.resolve()` 异步执行。

### 5.3 检索流程

```
用户输入问题
    → 从 IndexedDB 加载当前 session 的所有 isFileChunk=true 记录
    → 计算余弦相似度
    → 过滤 >= 0.2（比对话 RAG 的 0.25 更宽松）
    → 取 Top-3
    → 格式化为 system prompt：
       "以下是用户上传文件中与当前问题相关的内容："
```

## 6. 同步 vs 异步索引

| 操作 | 时机 | 同步/异步 |
|------|------|:---:|
| 消息嵌入 | 切换 session 时 | 异步保存到 IndexedDB，搜索时先查缓存 |
| 文件 chunk 嵌入 | 消息包含文件内容时 | 异步（不阻塞回复） |
| 检索 | 每次发送消息前 | 同步（等待结果） |

## 7. 缓存一致性

**消息缓存**：每次 `indexSession` 时：
1. 检查 IndexedDB 中是否有与当前消息列表完全匹配的缓存（按 id + text 对比）
2. 完全匹配 → 直接从内存加载，跳过计算
3. 不匹配 → 全部重算并写入

**文件缓存**：每次 `indexFileChunks` 时，先删除该文件的旧嵌入再写入新的。

## 8. 阈值与参数汇总

| 参数 | 对话 RAG | 文件 RAG |
|------|:---:|:---:|
| 相似度阈值 | 0.25 | 0.20 |
| 最大结果数 | 3 | 3 |
| 激活条件 | 历史 > 4 条 | 有文件 chunk 存在 |
| 分块大小 | — | 20 行/块 |
| 重叠行数 | — | 3 行 |