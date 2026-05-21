"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface Message {
  role: string;
  content: string;
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
}

const STORAGE_KEY = "chat_sessions";
const SYSTEM_PROMPT = "你是一个资深 React 专家";
const MAX_CONTEXT_PAIRS = 15; // 保留最近 15 轮（用户+助手）

/** 生成短 id */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 从 messages 中提取标题（取第一条用户消息的前 20 字） */
function extractTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "新会话";
  const title = firstUser.content.replace(/[\n\r]/g, " ").trim();
  return title.length > 20 ? title.slice(0, 20) + "…" : title;
}

export function useSession() {
  // 所有会话列表
  const [sessions, setSessions] = useState<Session[]>([]);

  // 当前活跃的会话 id
  const [activeId, setActiveId] = useState<string>("");

  // 是否已挂载
  const [isMounted, setIsMounted] = useState(false);

  // 用于保存当前请求 controller
  const controllerRef = useRef<AbortController | null>(null);

  // 底部 DOM 引用
  const bottomRef = useRef<HTMLDivElement>(null);

  // 记录正在 streaming 的消息索引
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);

  // 当前会话的 messages（派生）
  const messages =
    sessions.find((s) => s.id === activeId)?.messages ?? [];

  // 组件挂载后从 localStorage 恢复
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: Session[] = JSON.parse(saved);
        if (parsed.length > 0) {
          setSessions(parsed);
          setActiveId(parsed[0].id);
          setIsMounted(true);
          return;
        }
      } catch {}
    }
    // 无数据时创建一个默认会话
    const defaultSession: Session = {
      id: uid(),
      title: "新会话",
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
    };
    setSessions([defaultSession]);
    setActiveId(defaultSession.id);
    setIsMounted(true);
  }, []);

  // 用 ref 跟踪最新 sessions，防抖写入 localStorage
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // 持久化所有会话（防抖 1s，stream 过程中不频繁写入）
  useEffect(() => {
    if (!isMounted) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionsRef.current));
      } catch {
        console.warn("localStorage 已满，部分历史可能无法保存");
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [sessions, isMounted]);

  // 组件卸载或切换页面时立即保存一次
  useEffect(() => {
    if (!isMounted) return;
    return () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionsRef.current));
      } catch {}
    };
  }, [isMounted]);

  // 更新当前会话的 messages
  const updateMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeId) return s;
          const nextMessages =
            typeof updater === "function" ? updater(s.messages) : updater;
          return { ...s, messages: nextMessages };
        })
      );
    },
    [activeId]
  );

  // 滚动到底部
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  };

  const scrollToBottomSmooth = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 对发送给 API 的 messages 做 context 截断
  // 保留 system prompt + 最近 MAX_CONTEXT_PAIRS 轮对话
  const trimContext = (msgs: Message[]): Message[] => {
    const system = msgs.filter((m) => m.role === "system");
    const history = msgs.filter((m) => m.role !== "system");
    // 取最近 MAX_CONTEXT_PAIRS * 2 条（user + assistant 成对）
    const recent = history.slice(-MAX_CONTEXT_PAIRS * 2);
    return [...system, ...recent];
  };

  // 发送消息
  const send = async (text: string) => {
    const controller = new AbortController();
    controllerRef.current = controller;

    const userMessage: Message = { role: "user", content: text };

    // 先更新 messages 和标题
    updateMessages((prev) => {
      const next = [...prev, userMessage, { role: "assistant", content: "" }];
      // 同步更新标题
      setSessions((sessions) =>
        sessions.map((s) =>
          s.id === activeId ? { ...s, title: extractTitle(next) } : s
        )
      );
      return next;
    });

    setStreamingIndex(0);

    try {
      // 发送时截断 context（UI 中保留完整记录）
      const trimmedMessages = trimContext([...messages, userMessage]);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: trimmedMessages }),
        signal: controller.signal,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        assistantText += decoder.decode(value);

        updateMessages((prev) => {
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

  // 停止
  const stop = () => {
    controllerRef.current?.abort();
    setStreamingIndex(null);
  };

  // 新建会话
  const createSession = () => {
    const newSession: Session = {
      id: uid(),
      title: "新会话",
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveId(newSession.id);
  };

  // 切换会话
  const switchSession = (id: string) => {
    setActiveId(id);
    setStreamingIndex(null);
  };

  // 删除会话
  const deleteSession = (id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const defaultSession: Session = {
          id: uid(),
          title: "新会话",
          messages: [{ role: "system", content: SYSTEM_PROMPT }],
        };
        setActiveId(defaultSession.id);
        return [defaultSession];
      }
      if (id === activeId) {
        setActiveId(filtered[0].id);
      }
      return filtered;
    });
  };

  return {
    sessions,
    activeId,
    messages,
    isMounted,
    bottomRef,
    streamingIndex,
    send,
    stop,
    clear: deleteSession,
    createSession,
    switchSession,
    deleteSession,
  };
}
