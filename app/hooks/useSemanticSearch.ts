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

/**
 * 浏览器端语义搜索 hook
 *
 * 使用 @huggingface/transformers 加载 MiniLM-L6-v2 模型，
 * 对消息生成向量嵌入后做余弦相似度搜索。
 *
 * 用法:
 * ```ts
 * const { isReady, init, addMessages, search } = useSemanticSearch();
 *
 * // 1. 初始化（模型加载）
 * await init();
 *
 * // 2. 批量添加消息到索引
 * await addMessages(visibleMessages.map(m => ({ id: m.id, text: m.content })));
 *
 * // 3. 语义搜索
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
      // 动态导入 transformers.js 的 web 版本
      const mod = await import(
        "@huggingface/transformers"
      );
      const pipeline = mod.pipeline;

      // 使用 feature-extraction pipeline 加载 MiniLM 模型
      // 这个模型体积小（~80MB），适合浏览器端运行
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipe = await (pipeline as any)("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        quantized: true, // 使用量化版本减小体积
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

  // 添加单条消息到索引
  const addMessage = useCallback(
    async (id: string, text: string) => {
      if (!pipelineRef.current) await init();
      const embedding = await embed(text);
      embeddingsRef.current.push({ id, text, embedding });
    },
    [init, embed]
  );

  // 批量添加消息到索引（更高效）
  const addMessages = useCallback(
    async (messages: SearchableMessage[]) => {
      if (!pipelineRef.current) await init();
      const results = await Promise.all(
        messages.map(async (msg) => {
          const embedding = await embed(msg.text);
          return { id: msg.id, text: msg.text, embedding };
        })
      );
      embeddingsRef.current = results;
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

      // 计算余弦相似度
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
    addMessage,
    addMessages,
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
