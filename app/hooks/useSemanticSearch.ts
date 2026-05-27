"use client";

import { useState, useRef, useCallback } from "react";

export interface SearchableMessage {
  id: string;
  text: string;
}

export interface SearchResult {
  id: string;
  text: string;
  score: number;
}

// ── IndexedDB 工具 ──────────────────────────────────────────────

const DB_NAME = "semantic-search-cache";
const DB_VERSION = 1;
const STORE_NAME = "embeddings";

interface EmbeddingRecord {
  key: string; // "sessionId:messageId"
  sessionId: string;
  messageId: string;
  text: string;
  embedding: number[]; // Float32Array 序列化为普通数组
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 保存当前 session 的所有嵌入向量到 IndexedDB（先清旧数据再写入） */
async function saveEmbeddingsToDB(
  sessionId: string,
  items: { id: string; text: string; embedding: Float32Array }[]
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  // 清除该 session 的旧缓存
  const index = store.index("sessionId");
  const range = IDBKeyRange.only(sessionId);
  await new Promise<void>((resolve, reject) => {
    const cursorReq = index.openCursor(range);
    cursorReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });

  // 写入新数据
  const now = Date.now();
  for (const item of items) {
    store.put({
      key: `${sessionId}:${item.id}`,
      sessionId,
      messageId: item.id,
      text: item.text,
      embedding: Array.from(item.embedding),
      updatedAt: now,
    } satisfies EmbeddingRecord);
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 从 IndexedDB 读取指定 session 的嵌入向量（公开导出，供 Conversation RAG 使用） */
export async function loadEmbeddingsFromDB(
  sessionId: string
): Promise<{ id: string; text: string; embedding: Float32Array }[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const index = store.index("sessionId");

  return new Promise((resolve) => {
    const results: { id: string; text: string; embedding: Float32Array }[] = [];
    const req = index.openCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        const record = cursor.value as EmbeddingRecord;
        results.push({
          id: record.messageId,
          text: record.text,
          embedding: new Float32Array(record.embedding),
        });
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => resolve([]);
  });
}

/**
 * 检查 IndexedDB 中指定 session 的缓存是否与传入的消息列表匹配。
 * 返回匹配的嵌入（全部命中）或 null（有新增/缺失消息需要重建）。
 */
async function checkCacheMatch(
  sessionId: string,
  messages: SearchableMessage[]
): Promise<{ id: string; text: string; embedding: Float32Array }[] | null> {
  const cached = await loadEmbeddingsFromDB(sessionId);
  if (cached.length !== messages.length) return null;

  // 按 id 建立索引，检查每条消息是否都有缓存且 text 一致
  const cacheMap = new Map(cached.map((c) => [c.id, c]));
  for (const msg of messages) {
    const c = cacheMap.get(msg.id);
    if (!c || c.text !== msg.text) return null;
  }
  return cached;
}

// ── Hook ────────────────────────────────────────────────────────

/**
 * 浏览器端语义搜索 hook
 *
 * 使用 @huggingface/transformers 加载 MiniLM-L6-v2 模型，
 * 对消息生成向量嵌入后做余弦相似度搜索。
 *
 * 嵌入向量会持久化到 IndexedDB，后续访问相同 session 时跳过重复计算。
 *
 * 用法:
 * ```ts
 * const { isReady, init, indexSession, search } = useSemanticSearch();
 *
 * // 索引当前 session（自动查缓存或重新计算）
 * await indexSession("session-1", [
 *   { id: "msg-1", text: "hello" },
 * ]);
 *
 * // 语义搜索
 * const results = await search("你的查询", 5);
 * ```
 */
export function useSemanticSearch() {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelineRef = useRef<any>(null);
  const embeddingsRef = useRef<
    { id: string; text: string; embedding: Float32Array }[]
  >([]);

  // 延迟初始化，避免首次渲染时触发模型下载
  const init = useCallback(async () => {
    if (pipelineRef.current) return;
    setIsLoading(true);
    try {
      const mod = await import("@huggingface/transformers");
      const pipeline = mod.pipeline;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipe = await (pipeline as any)("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        quantized: true,
      });
      pipelineRef.current = pipe;
      setIsReady(true);
    } catch (error) {
      console.error("语义搜索模型加载失败:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 为单条消息生成嵌入向量
  const embed = useCallback(
    async (text: string): Promise<Float32Array> => {
      if (!pipelineRef.current) throw new Error("模型尚未初始化");
      const result = await pipelineRef.current(text, {
        pooling: "mean",
        normalize: true,
      });
      return result.data as Float32Array;
    },
    []
  );

  /**
   * 索引指定 session 的消息：
   * 1. 尝试从 IndexedDB 读取缓存
   * 2. 缓存命中且完整 → 直接加载到内存
   * 3. 缓存不命中 → 重新计算并写入 IndexedDB
   */
  const indexSession = useCallback(
    async (sessionId: string, messages: SearchableMessage[]) => {
      if (messages.length === 0) {
        embeddingsRef.current = [];
        return;
      }

      // 先尝试从 IndexedDB 加载缓存
      const cached = await checkCacheMatch(sessionId, messages);
      if (cached) {
        embeddingsRef.current = cached;
        return;
      }

      // 缓存不命中，需要重新计算
      if (!pipelineRef.current) await init();
      setIsLoading(true);
      try {
        const results = await Promise.all(
          messages.map(async (msg) => {
            const embedding = await embed(msg.text);
            return { id: msg.id, text: msg.text, embedding };
          })
        );
        embeddingsRef.current = results;

        // 异步写入 IndexedDB（不阻塞搜索）
        saveEmbeddingsToDB(sessionId, results).catch((err) =>
          console.warn("保存嵌入向量到 IndexedDB 失败:", err)
        );
      } finally {
        setIsLoading(false);
      }
    },
    [init, embed]
  );

  // 清除索引
  const clear = useCallback(() => {
    embeddingsRef.current = [];
  }, []);

  // 语义搜索：计算查询与所有索引消息的余弦相似度，返回 Top-K
  const search = useCallback(
    async (query: string, topK: number = 5): Promise<SearchResult[]> => {
      if (!pipelineRef.current || embeddingsRef.current.length === 0) {
        return [];
      }

      const queryEmbedding = await embed(query);

      const scores = embeddingsRef.current.map((item) => {
        const dot = dotProduct(queryEmbedding, item.embedding);
        return { id: item.id, text: item.text, score: dot };
      });

      scores.sort((a, b) => b.score - a.score);
      return scores.slice(0, topK);
    },
    [embed]
  );

  return {
    isReady,
    isLoading,
    init,
    indexSession,
    search,
    clear,
  };
}

/** 计算两个向量的点积（向量已归一化，点积 = 余弦相似度） */
function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
