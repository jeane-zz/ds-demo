'use client'

import { useState } from "react";

export default function Home() {
  // 输入框
  const [input, setInput] = useState("");

  // 聊天记录
  const [messages, setMessages] = useState([
    {
      role: "system",
      content: "你是一个资深 React 专家",
    },
  ]);

  // loading
  const [loading, setLoading] = useState(false);

  // 发送消息
  const handleSend = async () => {
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
    });

    // 读取 stream
    const reader = response.body.getReader();

    const decoder = new TextDecoder();

    let assistantText = "";

    while (true) {
      const { done, value } =
        await reader.read();

      if (done) break;

      // chunk 转字符串
      const chunk =
        decoder.decode(value);

      assistantText += chunk;

      // 实时更新最后一条 assistant
      setMessages((prev) => {
        const cloned = [...prev];

        cloned[cloned.length - 1] = {
          role: "assistant",
          content: assistantText,
        };

        return cloned;
      });
    }

    setLoading(false);
  };

  return (
    <div
      style={{
        width: 800,
        margin: "40px auto",
        fontFamily: "sans-serif",
      }}
    >
      <h1>DeepSeek Chat</h1>

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
        {messages
          .filter(
            (msg) =>
              msg.role !== "system"
          )
          .map((msg, index) => (
            <div
              key={index}
              style={{
                marginBottom: 20,
              }}
            >
              <b>
                {msg.role === "user"
                  ? "你"
                  : "AI"}
                :
              </b>

              <div
                style={{
                  whiteSpace:
                    "pre-wrap",
                  marginTop: 8,
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
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
          onClick={handleSend}
          disabled={loading}
          style={{
            width: 100,
          }}
        >
          {loading
            ? "生成中..."
            : "发送"}
        </button>
      </div>
    </div>
  );
}
