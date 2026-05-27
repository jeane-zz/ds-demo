/**
 * Conversation RAG
 *
 * 在发送给 LLM 的消息中，从全量历史中检索与当前用户问题最相关的
 * 历史消息（基于语义嵌入），作为额外 context 拼入 system prompt。
 *
 * 使用已在 IndexedDB 中缓存的嵌入向量，无需重复加载模型。
 */

import type { Message } from "../hooks/useSession";

/** RAG 检索配置 */
export interface RagConfig {
  /** 最多检索多少条相关消息 */
  maxResults: number;
  /** 是否启用 RAG */
  enabled: boolean;
  /** 相似度阈值（低于此值不返回结果） */
  threshold: number;
}

const DEFAULT_CONFIG: RagConfig = {
  maxResults: 3,
  enabled: true,
  threshold: 0.25,
};

/**
 * 从全量历史中检索与当前用户问题最相关的对话上下文。
 *
 * 1. 从 IndexedDB 读取当前 session 的缓存嵌入向量
 * 2. 用 transformers.js 对查询做嵌入
 * 3. 计算余弦相似度，取 Top-K
 * 4. 包装为 system prompt 格式返回
 *
 * @param sessionId 当前会话 id
 * @param query 当前用户问题
 * @param allHistory 当前会话全量历史消息（不含 system）
 * @param config 配置项
 * @returns 包装为 system role 的上下文消息，检索失败或没有相关结果时返回空数组
 */
export async function retrieveRelevantContext(
  sessionId: string,
  query: string,
  allHistory: Message[],
  config: Partial<RagConfig> = {}
): Promise<Message[]> {
  const { maxResults, enabled, threshold } = { ...DEFAULT_CONFIG, ...config };

  if (!enabled || !query.trim() || allHistory.length === 0) return [];

  try {
    // 1. 从 IndexedDB 读取缓存的嵌入向量
    const { loadEmbeddingsFromDB } = await import(
      "../hooks/useSemanticSearch"
    );

    const cached = await loadEmbeddingsFromDB(sessionId);
    if (cached.length === 0) return [];

    // 2. 用 transformers.js 对查询做嵌入
    const mod = await import("@huggingface/transformers");
    const pipeline = mod.pipeline;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pipe = await (pipeline as any)(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { quantized: true }
    );
    const result = await pipe(query, { pooling: "mean", normalize: true });
    const queryEmbedding = result.data as Float32Array;

    // 3. 计算余弦相似度
    const scored = cached
      .map((item) => ({
        id: item.id,
        score: dotProduct(queryEmbedding, item.embedding),
      }))
      .filter((s) => s.score >= threshold);

    scored.sort((a, b) => b.score - a.score);
    const topIds = new Set(scored.slice(0, maxResults).map((s) => s.id));

    // 4. 映射回原始 Message（保持原始顺序）
    const relevantMessages = allHistory.filter((msg, i) => {
      const msgId = `${sessionId}-${i}`;
      return topIds.has(msgId);
    });

    if (relevantMessages.length === 0) return [];

    // 包装为 system prompt
    const contextText = relevantMessages
      .map((m) => {
        const label = m.role === "user" ? "用户" : "AI助手";
        return `[${label}]: ${m.content}`;
      })
      .join("\n\n");

    return [
      {
        role: "system",
        content: `以下是对话历史中与当前问题相关的上下文，请参考这些信息来回答：\n\n${contextText}`,
      },
    ];
  } catch (error) {
    console.warn("RAG 检索失败，降级为纯上下文模式:", error);
    return [];
  }
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
