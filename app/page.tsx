'use client'

import { useState, useRef, useEffect } from "react";
import MessageItem from "./components/MessageItem";
import InputArea from "./components/InputArea";
import styles from "./page.module.css";

export default function Home() {
  // 聊天记录
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(
    []
  );

  // 是否已挂载（用于 hydration 后加载 localStorage）
  const [isMounted, setIsMounted] = useState(false);

  // 组件挂载后从 localStorage 恢复聊天记录
  useEffect(() => {
    const saved = localStorage.getItem("chat_messages");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setMessages([
          {
            role: "system",
            content: "你是一个资深 React 专家",
          },
          ...parsed,
        ]);
      } catch {}
    } else {
      setMessages([
        {
          role: "system",
          content: "你是一个资深 React 专家",
        },
      ]);
    }
    setIsMounted(true);
  }, []);

  // 持久化聊天记录（排除 system 消息），只在挂载后执行
  useEffect(() => {
    if (!isMounted) return;
    const history = messages.filter((m) => m.role !== "system");
    localStorage.setItem("chat_messages", JSON.stringify(history));
  }, [messages, isMounted]);

  // 用于保存当前请求 controller
  const controllerRef = useRef<AbortController | null>(null);

  // 保存底部Dom
  const bottomRef = useRef<HTMLDivElement>(null);

  // 记录正在 streaming 的消息索引（用于控制是否高亮）
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);

  // 滚动到底部
  // 核心思路：每次更新立即 auto 滚动，不依赖 useEffect，避免闪烁
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  };

  // streaming 结束后 smooth 滚动一次
  const scrollToBottomSmooth = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 发送消息
  const handleSend = async (text: string) => {
    const controller = new AbortController();
    controllerRef.current = controller;

    const userMessage = {
      role: "user",
      content: text,
    };

    const newMessages = [...messages, userMessage];

    // 先更新 UI
    setMessages([
      ...newMessages,
      {
        role: "assistant",
        content: "",
      },
    ]);

    // 记录当前 assistant 消息的索引（过滤掉 system 后的位置）
    setStreamingIndex(newMessages.filter((m) => m.role !== "system").length);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: newMessages,
        }),
        signal: controller.signal,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        assistantText += decoder.decode(value);

        setMessages((prev) => {
          const cloned = [...prev];
          cloned[cloned.length - 1] = {
            role: "assistant",
            content: assistantText,
          };
          return cloned;
        });

        requestAnimationFrame(scrollToBottom);
      }

      scrollToBottomSmooth();
      setStreamingIndex(null);
    } catch (error) {
      console.error("Send message error:", error);
    }
  };

  // 停止当前回答
  const handleStop = () => {
    controllerRef.current?.abort();
    setStreamingIndex(null);
  };

  // 清除聊天记录
  const handleClear = () => {
    localStorage.removeItem("chat_messages");
    setMessages([
      {
        role: "system",
        content: "你是一个资深 React 专家",
      },
    ]);
  }
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>DeepSeek Chat</h1>
        <button onClick={handleClear} className={styles.clearBtn}>
          清除历史
        </button>
      </div>

      {/* 聊天区域 */}
      <div className={styles.chatArea}>
        {isMounted &&
          messages
          .filter(
            (msg) =>
              msg.role !== "system"
          )
          .map((msg, index) => (
            <MessageItem
              key={index}
              role={msg.role as "user" | "assistant"}
              content={msg.content}
              highlighted={
                streamingIndex === null || index !== streamingIndex
              }
            />
          ))}
          <div ref={bottomRef}></div>
      </div>

      {/* 输入区域 */}
      <InputArea onSend={handleSend} onStop={handleStop} />
    </div>
  );
}
