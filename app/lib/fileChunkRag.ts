/**
 * File RAG
 *
 * 对上传的 .txt / .md 文件做分块、嵌入、检索，将最相关片段
 * 拼入 LLM 上下文。分块以行数分割，确保跨句连贯。
 *
 * 嵌入向量持久化到 IndexedDB（与 useSemanticSearch 共用数据库），
 * 检索时复用已在浏览器中缓存的 MiniLM 模型。
 */

export interface FileChunk {
  id: string;
  fileName: string;
  text: string;
  index: number;
  total: number;
}

export interface ScoredFileChunk extends FileChunk {
  score: number;
}

const DB_NAME = "semantic-search-cache";
const DB_VERSION = 1;
const STORE_NAME = "embeddings";

interface EmbeddingRecord {
  key: string;
  sessionId: string;
  messageId: string;
  text: string;
  embedding: number[];
  updatedAt: number;
  /** 标记为文件 chunk，与对话消息区分 */
  isFileChunk?: boolean;
  fileName?: string;
  chunkIndex?: number;
  chunkTotal?: number;
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

/** 按行分块 */
export function chunkTextFile(
  fileName: string,
  content: string,
  linesPerChunk = 20,
  overlapLines = 3
): FileChunk[] {
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  const chunks: FileChunk[] = [];
  const total = Math.ceil(lines.length / (linesPerChunk - overlapLines));
  let start = 0;

  for (let i = 0; start < lines.length; i++) {
    const end = Math.min(start + linesPerChunk, lines.length);
    const chunkLines = lines.slice(start, end);
    chunks.push({
      id: `file:${fileName}:${i}`,
      fileName,
      text: chunkLines.join("\n"),
      index: i,
      total,
    });
    start += linesPerChunk - overlapLines;
  }

  return chunks;
}

/** 获取已缓存的嵌入 pipeline（单例） */
let pipelineCache: unknown = null;

async function getPipeline() {
  if (pipelineCache) return pipelineCache;
  const mod = await import("@huggingface/transformers");
  const pipe = await (mod.pipeline as (
    task: string,
    model: string,
    opts?: { quantized?: boolean }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>)("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: true,
  });
  pipelineCache = pipe;
  return pipe;
}

/** 为单个文本生成嵌入向量 */
async function embed(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const result = await pipe(text, { pooling: "mean", normalize: true });
  return result.data as Float32Array;
}

/** 对文件分块并保存嵌入到 IndexedDB */
export async function indexFileChunks(
  sessionId: string,
  fileName: string,
  content: string
): Promise<void> {
  const chunks = chunkTextFile(fileName, content);
  if (chunks.length === 0) return;

  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  // 清除该文件的旧缓存
  const prefix = `${sessionId}:file:${fileName}:`;
  const index = store.index("sessionId");
  const range = IDBKeyRange.only(sessionId);
  await new Promise<void>((resolve, reject) => {
    const cursorReq = index.openCursor(range);
    cursorReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        const record = cursor.value as EmbeddingRecord;
        if (record.key?.startsWith(prefix)) {
          store.delete(cursor.primaryKey);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });

  const now = Date.now();
  for (const chunk of chunks) {
    const embedding = await embed(chunk.text);
    store.put({
      key: `${sessionId}:${chunk.id}`,
      sessionId,
      messageId: chunk.id,
      text: chunk.text,
      embedding: Array.from(embedding),
      updatedAt: now,
      isFileChunk: true,
      fileName: chunk.fileName,
      chunkIndex: chunk.index,
      chunkTotal: chunk.total,
    } satisfies EmbeddingRecord);
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 从 IndexedDB 加载当前 session 的所有文件 chunks */
async function loadFileChunksFromDB(
  sessionId: string
): Promise<{ id: string; text: string; fileName: string; index: number; total: number; embedding: Float32Array }[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const index = store.index("sessionId");

  return new Promise((resolve) => {
    const results: { id: string; text: string; fileName: string; index: number; total: number; embedding: Float32Array }[] = [];
    const req = index.openCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result;
      if (cursor) {
        const record = cursor.value as EmbeddingRecord;
        if (record.isFileChunk) {
          results.push({
            id: record.messageId,
            text: record.text,
            fileName: record.fileName ?? "unknown",
            index: record.chunkIndex ?? 0,
            total: record.chunkTotal ?? 1,
            embedding: new Float32Array(record.embedding),
          });
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => resolve([]);
  });
}

/** 检索与查询最相关的文件 chunks */
export async function searchFileChunks(
  query: string,
  sessionId: string,
  topK = 3,
  threshold = 0.2
): Promise<ScoredFileChunk[]> {
  if (!query.trim()) return [];

  const chunks = await loadFileChunksFromDB(sessionId);
  if (chunks.length === 0) return [];

  const queryEmbedding = await embed(query);

  const scored = chunks
    .map((c) => ({
      id: c.id,
      fileName: c.fileName,
      text: c.text,
      index: c.index,
      total: c.total,
      score: dotProduct(queryEmbedding, c.embedding),
    }))
    .filter((s) => s.score >= threshold);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
