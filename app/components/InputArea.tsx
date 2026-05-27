"use client";

import { useState, useRef, useMemo, useLayoutEffect } from "react";
import styles from "./InputArea.module.css";
import { estimateTokens } from "../utils/tokenEstimate";

// DeepSeek-chat 上下文上限 64K
const TOKEN_LIMIT = 64000;
const TOKEN_WARN = 50000;
const TOKEN_DANGER = 60000;

interface Message {
  role: string;
  content: string;
}

interface InputAreaProps {
  /** 发送消息 */
  onSend: (content: string) => Promise<void>;
  /** 停止生成 */
  onStop: () => void;
  /** 手动压缩历史 */
  onCompress: () => Promise<{ ok: boolean; error?: string }>;
  /** 当前会话的历史消息（用于 token 估算） */
  messages: Message[];
  /** 当前会话已有的压缩摘要（仅用于 UI 提示） */
  summary?: string;
}

export default function InputArea({
  onSend,
  onStop,
  onCompress,
  messages,
  summary,
}: InputAreaProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const loadingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 让 textarea 高度跟随内容，受 CSS 上的 min-height / max-height 兜底
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // 估算 token
  const totalTokens = useMemo(() => {
    const historyTokens = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0
    );
    const inputTokens = estimateTokens(input);
    return historyTokens + inputTokens;
  }, [messages, input]);

  const tokenLevel: "ok" | "warn" | "danger" =
    totalTokens >= TOKEN_DANGER
      ? "danger"
      : totalTokens >= TOKEN_WARN
      ? "warn"
      : "ok";

  // 与 useSession 中 KEEP_RECENT_PAIRS=3 保持一致：
  // 至少要有 > 6 条非 system 消息才有「更早的历史」可压
  const canCompress = useMemo(
    () => messages.filter((m) => m.role !== "system").length > 6,
    [messages]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loadingRef.current) return;

    setLoading(true);
    loadingRef.current = true;
    setInput("");

    try {
      await onSend(text);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const handleStop = () => {
    onStop();
    setLoading(false);
    loadingRef.current = false;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCompress = async () => {
    if (compressing || loading || !canCompress) return;
    setCompressing(true);
    try {
      const result = await onCompress();
      if (!result.ok) {
        console.warn("压缩失败：", result.error);
      }
    } finally {
      setCompressing(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={`${styles.estimate} ${styles[tokenLevel]}`}>
        ≈ {totalTokens.toLocaleString()} / {TOKEN_LIMIT.toLocaleString()} tokens
        {tokenLevel === "warn" && " · 接近上限"}
        {tokenLevel === "danger" && " · 即将超出，建议压缩或新建会话"}
        {summary && " · 已含摘要"}
        <button
          onClick={handleCompress}
          disabled={compressing || loading || !canCompress}
          className={styles.compressBtn}
          title={
            canCompress
              ? "把较早的对话压缩成摘要以节省 token"
              : "历史不足 3 轮，暂无可压缩内容"
          }
        >
          {compressing ? "压缩中…" : "压缩历史"}
        </button>
      </div>
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="请输入... (Enter 发送，Shift+Enter 换行)"
          className={styles.inputField}
          disabled={loading}
        />

        <button
          onClick={loading ? handleStop : handleSend}
          className={styles.sendBtn}
        >
          {loading ? "停止生成" : "发送"}
        </button>
      </div>
    </div>
  );
}
