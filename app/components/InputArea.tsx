"use client";

import { useState, useRef } from "react";
import styles from "./InputArea.module.css";

interface InputAreaProps {
  /** 发送消息 */
  onSend: (content: string) => Promise<void>;
  /** 停止生成 */
  onStop: () => void;
}

export default function InputArea({ onSend, onStop }: InputAreaProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

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
  );
}
