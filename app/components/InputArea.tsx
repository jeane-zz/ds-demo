"use client";

import { useState, useRef, useMemo } from "react";
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
  /** 当前会话的历史消息（用于 token 估算） */
  messages: Message[];
}

export default function InputArea({
  onSend,
  onStop,
  messages,
}: InputAreaProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={`${styles.estimate} ${styles[tokenLevel]}`}>
        ≈ {totalTokens.toLocaleString()} / {TOKEN_LIMIT.toLocaleString()} tokens
        {tokenLevel === "warn" && " · 接近上限"}
        {tokenLevel === "danger" && " · 即将超出，建议新建会话"}
      </div>
      <div className={styles.inputRow}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="请输入..."
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
