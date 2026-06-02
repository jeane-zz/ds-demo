# 技术方案文档索引

本目录包含项目关键技术方案的设计说明文档。

## 文档列表

| # | 文件 | 主题 |
|---|------|------|
| 01 | [LLM Provider 架构](01-llm-provider-architecture.md) | 本地优先 + 优雅降级的双层 Provider 设计 |
| 02 | [双层 RAG 策略](02-dual-rag-strategy.md) | 对话 RAG + 文件 RAG 的语义检索增强生成方案 |
| 03 | [本地工具调用系统](03-tool-calling-system.md) | Function Calling 注册-执行机制与多轮决策 |
| 04 | [SQLite 存储与数据迁移](04-sqlite-storage-and-migration.md) | 三层存储架构、FTS5 全文检索、渐进式迁移 |
| 05 | [前端状态管理与性能优化](05-state-management-and-performance.md) | Hooks 驱动、TaskQueue、rAF 节流、虚拟化渲染 |
| 06 | [知识文档系统](06-knowledge-document-system.md) | AI 自动提取、分类管理、文档-对话双向关联 |

## 核心设计哲学

| 原则 | 体现 |
|------|------|
| **本地优先** | Ollama 默认，DeepSeek 仅作 fallback；数据全量 SQLite 本地存储 |
| **渐进增强** | localStorage → SQLite 迁移链，不破坏既有使用流程 |
| **防御性编程** | RAG 降级、TaskQueue 防竞态、useRef 防闭包、JSON 解析容错 |
| **最小依赖** | 无 Redux/Zustand/Prisma，Handmade hooks + DAO + 原生 fetch |
| **知识闭环** | 对话 → 文档提取 → FTS5 检索 → Tool Calling 复用 → 再对话 |

## 关键架构图

```
┌──────────── Browser ────────────┐
│                                 │
│   React 19 Components           │
│     ↕ Hooks (useSessionWithDB)  │
│     ↕ storage.ts (API Adapter)  │
│     ↕ IndexedDB (向量缓存)      │
│     ↕ MiniLM (浏览器端嵌入)     │
└─────────── HTTP ────────────────┘
         ↕ fetch()
┌───────── Server ────────────────┐
│                                 │
│   Next.js 16 API Routes         │
│     ↕ runWithLlmFallback        │
│     ├── Ollama (本地)           │
│     └── DeepSeek (云端)         │
│     ↕ Tool Registry             │
│     ↕ DAO (Session/Message/Doc) │
│     ↕ SQLite + FTS5             │
└─────────────────────────────────┘
         ↕ better-sqlite3
┌────── ~/.ai-workspace/ ─────────┐
│   data.db (sessions/messages/   │
│            documents/documents_fts)│
└─────────────────────────────────┘
```