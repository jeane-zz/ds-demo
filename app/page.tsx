'use client'

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import {Prism as SyntaxHighlighter} from 'react-syntax-highlighter';
import {oneDark} from 'react-syntax-highlighter/dist/esm/styles/prism';

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

  // 用于保存当前请求 controller
  const controllerRef = useRef(null);

  // 保存底部Dom
  const bottomRef = useRef<HTMLDivElement>(null);

  // loading
  const [loading, setLoading] = useState(false);

  // 滚动到底部
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }
  // 每次message更新都会自动滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
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
                <ReactMarkdown
                  components={{

                    // 接管代码块的渲染
                    code({
                      inline,
                      className,
                      children,
                      ...props
                    }) {
                      const match = /language-(\w+)/.exec(className || '');
                      
                      return !inline && match ? (
                        <SyntaxHighlighter
                          style={oneDark}
                          language={match[1]}
                          PreTag="div"
                          {...props}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      )
                    }


                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
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
