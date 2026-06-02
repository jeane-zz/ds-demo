# SQLite 存储与渐进式数据迁移方案

> 关键词：better-sqlite3 · FTS5 全文检索 · 外键约束 · 渐进式迁移 · 双存储适配

---

## 1. 问题与目标

项目从**纯浏览器端 localStorage** 起步，随着功能扩展（文档系统、全文搜索、多会话管理），localStorage 的局限性日益明显：
- 不支持结构化查询和全文检索
- 无法跨页面/跨设备共享
- 5-10MB 存储上限
- JSON 序列化/反序列化性能开销

目标：引入服务端 SQLite 替代 localStorage 作为主存储，同时**无损迁移**既有数据。

## 2. 存储分层架构

项目采用**三层存储**策略，各自服务于不同场景：

```
┌─────────────────────────────────────────────────────────────┐
│  SQLite (better-sqlite3)                                    │
│  ~/.ai-workspace/data.db                                    │
│                                                             │
│  ├── sessions 表：会话元数据                                │
│  ├── messages 表：对话消息                                   │
│  └── documents 表：结构化文档 + FTS5 全文索引               │
│                                                             │
│  用途：持久化存储、结构化查询、全文检索                       │
│  访问层：服务端 DAO（SessionDAO / MessageDAO / DocumentDAO） │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  IndexedDB (semantic-search-cache)                          │
│                                                             │
│  ├── embeddings 存储对象：向量嵌入                           │
│  │    每条包含 key / sessionId / text / embedding / isFileChunk │
│                                                             │
│  用途：浏览器端向量缓存，避免重复计算                         │
│  访问层：useSemanticSearch hook / fileChunkRag.ts            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  localStorage                                               │
│                                                             │
│  ├── theme：用户主题偏好                                      │
│  └── chat_sessions_migrated_to_sqlite：迁移标记               │
│                                                             │
│  用途：极少量键值对（主题、标记）                              │
│  旧数据（chat_sessions）已废弃，仅用于迁移读取                 │
└─────────────────────────────────────────────────────────────┘
```

## 3. SQLite Schema 设计

### 3.1 表结构

```sql
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  createdAt         INTEGER NOT NULL,  -- Unix 时间戳毫秒
  updatedAt         INTEGER NOT NULL,
  pinned            INTEGER DEFAULT 0,
  summary           TEXT,              -- 压缩后的对话摘要
  titleGenerated    INTEGER DEFAULT 0, -- LLM 标题是否已生成
  compressedUntil   INTEGER DEFAULT 0  -- 已压缩的消息条数
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  sessionId       TEXT NOT NULL,
  role            TEXT NOT NULL,        -- 'user' | 'assistant' | 'system'
  content         TEXT NOT NULL,
  createdAt       INTEGER NOT NULL,
  variants        TEXT,                 -- JSON 数组：regenerate 多版本
  activeVariant   INTEGER DEFAULT 0,    -- 当前激活版本索引
  FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE documents (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  category          TEXT,
  tags              TEXT,               -- JSON 数组
  problem           TEXT,
  solution          TEXT,
  code              TEXT,
  relatedSessionId  TEXT,
  createdAt         INTEGER NOT NULL,
  updatedAt         INTEGER NOT NULL,
  FOREIGN KEY (relatedSessionId) REFERENCES sessions(id) ON DELETE SET NULL
);
```

### 3.2 关键设计决策

**1. `ON DELETE CASCADE` vs `ON DELETE SET NULL`**

| 外键 | 删除行为 | 理由 |
|------|----------|------|
| `messages.sessionId → sessions.id` | CASCADE | 删除会话时，所有消息一起删除 |
| `documents.relatedSessionId → sessions.id` | SET NULL | 删除会话后，文档仍保留，但关联置空 |

**2. `variants` 用 TEXT 存 JSON 而非独立表**

- 消息变体是一个小众需求（通常只有 1-3 个版本）
- JSON 字段避免了额外 join 查询
- DAO 层负责序列化/反序列化，对上层透明

**3. 时间戳用 INTEGER 而非 DATETIME**

- 避免时区问题
- 便于比较和排序
- DAO 层返回 number，前端直接使用

### 3.3 索引策略

```sql
CREATE INDEX idx_messages_session ON messages(sessionId);
CREATE INDEX idx_messages_created ON messages(createdAt);
CREATE INDEX idx_sessions_pinned ON sessions(pinned, updatedAt DESC);
CREATE INDEX idx_documents_category ON documents(category);
CREATE INDEX idx_documents_session ON documents(relatedSessionId);
```

`idx_sessions_pinned` 是一个**复合索引**，满足"置顶优先 + 按更新时间倒排"的列表查询需求。

## 4. FTS5 全文检索方案

### 4.1 实现

```sql
-- external content 方式：倒排索引存于虚拟表，原始数据存原表
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title, tags, problem, solution, code,
    content='documents',          -- 指向原表
    content_rowid='rowid'         -- 通过原表的 rowid 关联
);

-- 三个触发器：插入/删除/更新时自动同步索引
CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, tags, problem, solution, code)
  VALUES (new.rowid, new.title, new.tags, new.problem, new.solution, new.code);
END;

CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, ...) VALUES ('delete', old.rowid, ...);
END;

CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, ...) VALUES ('delete', old.rowid, ...);
  INSERT INTO documents_fts(rowid, ...) VALUES (new.rowid, ...);
END;
```

**为什么用 external content 而非 contentless**：
- 内容不冗余，原表更新后索引由触发器维护
- 可对原表做任意列操作，FTS 表自动同步

### 4.2 首次创建回填

```typescript
const ftsExisted = db.prepare(`SELECT name FROM sqlite_master WHERE ...`).get();

if (!ftsExisted) {
  // 首次创建时重建索引，回填已有的文档
  db.exec(`INSERT INTO documents_fts(documents_fts) VALUES('rebuild');`);
}
```

使用 `sqlite_master` 判断 FTS 表是否首次创建（不能依赖 `count(*)`，因为 external content 表 count 代理到原表）。

### 4.3 搜索查询（DAO 层）

```typescript
static search(query: string): Document[] {
  // 1. 拆分查询词，每个词做前缀匹配
  const terms = query.trim().split(/\s+/).filter(Boolean)
    .map(term => `"${term.replace(/"/g, '""')}"*`);
  if (terms.length === 0) return [];

  // 2. 多词之间隐式 AND
  const matchExpr = terms.join(' ');

  // 3. 按 bm25 相关度排序
  const rows = db.prepare(`
    SELECT d.* FROM documents_fts f
    JOIN documents d ON d.rowid = f.rowid
    WHERE documents_fts MATCH ?
    ORDER BY bm25(documents_fts)
  `).all(matchExpr);
  // ...
}
```

## 5. 渐进式迁移方案

### 5.1 流程设计

```
首次加载
    ↓
检测迁移标记（localStorage）
    ↓
已标记 → 从 SQLite 读取，跳过迁移
未标记 → 开始迁移
    ↓
读取 localStorage 旧数据（chat_sessions）
    ↓
POST /api/sessions (action: migrateLegacySessions)
    ↓
服务端逐条：
  1. 检查 id 是否已存在（跳过已迁移的）
  2. 写入 sessions 表
  3. 写入 messages 表
    ↓
成功 → 写入迁移标记 → 前端黄条提示
失败 → 记录错误，不阻塞后续使用
```

### 5.2 幂等性

迁移是幂等的：
```typescript
if (SessionDAO.getById(legacy.id)) {
  continue;  // 同名 id 跳过，避免重复
}
```

### 5.3 UI 反馈

```typescript
type MigrationState =
  | { status: "idle" }
  | { status: "migrating" }       // 黄条正在迁移...
  | { status: "done", count: number }  // 已迁移 N 个会话
  | { status: "error", error: string };  // 迁移失败
```

## 6. API 适配器（前端存储层）

前端通过 `storage.ts` 与后端 API 通信，隔离数据访问细节：

```typescript
// app/lib/storage.ts

class StorageAdapter {
  async getAllSessions(): Promise<Session[]> {
    const response = await fetch('/api/sessions');
    return response.json();
  }

  async bulkCreateMessages(messages: Message[]): Promise<void> {
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bulkCreateMessages', data: { messages } }),
    });
  }

  async bulkReplaceMessages(sessionId: string, messages: Message[]): Promise<void> {
    // 事务性替换：先删除旧消息，再批量插入新消息
    await fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ action: 'bulkReplaceMessages', data: { sessionId, messages } }),
    });
  }
}
```

**设计理念**：`storage.ts` 提供与 DAO 层语义一致的接口，API Route 是透明代理，不添加业务逻辑。

## 7. 边界处理

| 场景 | 处理 |
|------|------|
| messages 表无 `variants` 列（旧 schema） | `db.ts` 启动时 `PRAGMA table_info` 检查并 ALTER TABLE 加列 |
| 外键约束失败（如插入不存在的 sessionId） | 数据库抛 SQLITE_CONSTRAINT，外层 try-catch 返回 500 + 错误信息 |
| 文档保存时关联的 session 已被删 | 自动将 `relatedSessionId` 置为 null |
| 并发迁移请求 | 幂等设计保证数据不重复 |
| 数据库文件损坏 | 启动即建表，出错时不影响旧文件（WAL 模式提供崩溃恢复） |
| FTS5 搜索空查询 | 返回空数组 |