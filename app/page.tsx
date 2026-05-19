'use client'

import { useState, useRef, useEffect } from "react";
import MessageItem from "./components/MessageItem";

export default function Home() {
  // 输入框
  const [input, setInput] = useState("我想学习一下React的设计思想，你能帮我解释一下吗？");

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
  const controllerRef = useRef(null);

  // 保存底部Dom
  const bottomRef = useRef<HTMLDivElement>(null);

  // loading
  const [loading, setLoading] = useState(false);

  // 记录正在 streaming 的消息索引（用于控制是否高亮）
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);

  // 滚动到底部
  // 核心思路：每次更新立即 auto 滚动，不依赖 useEffect，避免闪烁
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }

  // streaming 结束后 smooth 滚动一次
  const scrollToBottomSmooth = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }
  // 发送消息
  const handleSend = async () => {
    try {
      // 发消息时创建controller
    const controller = new AbortController();

    controllerRef.current = controller;

    
    if (!input.trim()) return;

    setLoading(true);

    // 用户消息
    const userMessage = {
      role: "user",
      content: input,
    };

    // 新消息列表
    const newMessages = [
      ...messages,
      userMessage,
    ];

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

    setInput("");

    // 请求后端
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: newMessages,
      }),
      signal: controller.signal, // 为fetch和controller建立关联；
    });

    // 读取 stream
    const reader = response.body.getReader();

    const decoder = new TextDecoder();

    let assistantText = "";

    // 开始 streaming — 每收到 chunk 就即时滚动
    while (true) {
      const { done, value } =
        await reader.read();

      if (done) break;

      // chunk 转字符串
      const chunk =
        decoder.decode(value);

      assistantText += chunk;

      // 实时更新最后一条 assistant，并在 DOM 更新后立即滚动
      setMessages((prev) => {
        const cloned = [...prev];

        cloned[cloned.length - 1] = {
          role: "assistant",
          content: assistantText,
        };

        return cloned;
      });

      // 请求下一帧滚动，确保 DOM 已更新
      requestAnimationFrame(scrollToBottom);
    }

    // streaming 结束后 highligh
    scrollToBottomSmooth();
    setStreamingIndex(null);
    } catch(error) {
        console.log(error)
    } finally {
      setLoading(false)
    }

  };

  // 停止当前回答
  const handleStop = () => {
    controllerRef.current?.abort();

    setLoading(false);
  }

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
    <div
      style={{
        width: 800,
        margin: "40px auto",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>DeepSeek Chat</h1>
        <button
          onClick={handleClear}
          style={{
            marginLeft: "auto",
            fontSize: 12,
            padding: "4px 10px",
            cursor: "pointer",
            border: "1px solid #ccc",
            borderRadius: 4,
            background: "#f5f5f5",
          }}
        >
          清除历史
        </button>
      </div>

      {/* 聊天区域 */}
      <div
        style={{
          border: "1px solid #ccc",
          padding: 20,
          height: 500,
          overflowY: "auto",
          marginBottom: 20,
        }}
      >
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
      <div
        style={{
          display: "flex",
          gap: 10,
        }}
      >
        <input

          value={input}
          onChange={(e) =>
            setInput(e.target.value)
          }
          placeholder="请输入..."
          style={{
            flex: 1,
            height: 40,
            padding: "0 10px",
          }}
        />

        <button
          onClick={!loading? handleSend : handleStop }
          // disabled={loading}
          style={{
            width: 100,
            cursor: 'pointer',
            border: '1px solid pink'
          }}
        >
          {loading
            ? "停止生成"
            : "发送"}
        </button>
      </div>
    </div>
  );
}
