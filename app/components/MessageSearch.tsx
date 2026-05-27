"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  useSemanticSearch,
  type SearchResult,
  type SearchableMessage,
} from "../hooks/useSemanticSearch";
import styles from "./MessageSearch.module.css";

interface MessageSearchProps {
  /** 当前会话 id，用于 IndexedDB 缓存 key */
  sessionId: string;
  /** 所有可搜索的消息列表 */
  messages: SearchableMessage[];
  /** 点击搜索结果时回调，传入该消息的 id */
  onSelectResult?: (id: string) => void;
}

/**
 * 消息语义搜索组件
 *
 * 集成到侧边栏，允许用户对当前会话的所有消息做语义搜索。
 * 嵌入向量会持久化到 IndexedDB，切换回已有索引的会话时无需重新计算。
 */
export function MessageSearch({ sessionId, messages, onSelectResult }: MessageSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isIndexed, setIsIndexed] = useState(false);
  const { isReady, isLoading, init, indexSession, search } =
    useSemanticSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevSessionKeyRef = useRef<string>("");
  const searchQueryRef = useRef("");

  // 当 session 或消息列表变化时重建索引。
  // 使用 sessionId + 消息数量 + 消息 id 列表作为 key，
  // 避免 streaming 过程中消息内容变化触发频繁重建。
  useEffect(() => {
    const key = `${sessionId}:${messages.length}:${messages.map((m) => m.id).join(",")}`;
    if (key === prevSessionKeyRef.current) return;
    prevSessionKeyRef.current = key;

    if (messages.length === 0) {
      setIsIndexed(false);
      return;
    }

    const doIndex = async () => {
      await init();
      await indexSession(sessionId, messages);
      setIsIndexed(true);
      // 重建后如果有进行中的查询，自动重新搜索
      if (searchQueryRef.current.trim()) {
        const res = await search(searchQueryRef.current, 6);
        setResults(res);
      }
    };
    doIndex();
  }, [sessionId, messages, init, indexSession, search]);

  // 防抖搜索
  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      searchQueryRef.current = value;
      setShowResults(true);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!value.trim()) {
        setResults([]);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        const res = await search(value, 6);
        setResults(res);
      }, 300);
    },
    [search]
  );

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onSelectResult?.(result.id);
      setShowResults(false);
      setQuery("");
      setResults([]);
      searchQueryRef.current = "";
      inputRef.current?.blur();
    },
    [onSelectResult]
  );

  const handleFocus = useCallback(() => {
    if (results.length > 0) setShowResults(true);
  }, [results]);

  const handleBlur = useCallback(() => {
    setTimeout(() => setShowResults(false), 200);
  }, []);

  const statusText = isLoading
    ? "加载模型中…"
    : !isReady
    ? "初始化中…"
    : isIndexed
    ? "搜索消息…"
    : "索引消息中…";

  return (
    <div className={styles.container}>
      <div className={styles.inputWrapper}>
        <svg
          className={styles.searchIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          placeholder={statusText}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={!isReady}
        />
        {isLoading && <span className={styles.spinner} />}
      </div>

      {showResults && results.length > 0 && (
        <div className={styles.results}>
          <div className={styles.resultsHeader}>
            语义搜索结果 ({results.length})
          </div>
          {results.map((result, i) => (
            <button
              key={`${result.id}-${i}`}
              className={styles.resultItem}
              onClick={() => handleSelect(result)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className={styles.resultText}>
                {truncate(result.text, 100)}
              </div>
              <span className={styles.resultScore}>
                {Math.round(result.score * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}

      {showResults && query.trim() && !isLoading && results.length === 0 && isReady && (
        <div className={styles.results}>
          <div className={styles.emptyState}>
            未找到相关结果
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}
