"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface Message {
  role: string;
  content: string;
}

export interface Session {
  id: string;
  title: string;
  pinned?: boolean;
  updatedAt: number;
  titleGenerated?: boolean;
  messages: Message[];
  /** 压缩后的历史摘要（不进入 messages，发送时再拼到 system） */
  summary?: string;
  /** 已被压缩的 messages 数量（不含 system），用于增量压缩 */
  compressedUntil?: number;
}

const STORAGE_KEY = "chat_sessions";
const SYSTEM_PROMPT = "你是一个资深 React 专家";
const MAX_CONTEXT_PAIRS = 15; // 保留最近 15 轮（用户+助手）
const DEFAULT_TITLE = "新会话";

/** 生成短 id */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 从 messages 中提取标题（取第一条用户消息的前 20 字） */
function extractTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return DEFAULT_TITLE;
  const title = firstUser.content.replace(/[\n\r]/g, " ").trim();
  return title.length > 20 ? title.slice(0, 20) + "…" : title;
}

/** 排序：置顶的排前面，同优先级按 updatedAt 降序（最新的在最前） */
function sortSessions(list: Session[]): Session[] {
  return list.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
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
  const activeSession = sessions.find((s) => s.id === activeId);
  const messages = activeSession?.messages ?? [];
  const summary = activeSession?.summary;

  // 组件挂载后从 localStorage 恢复
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: Session[] = JSON.parse(saved);
        if (parsed.length > 0) {
          // 对旧数据兼容：没有 updatedAt 的用当前时间
          const list = parsed.map((s) => ({
            ...s,
            pinned: !!s.pinned,
            updatedAt: s.updatedAt ?? Date.now(),
          }));
          setSessions(sortSessions(list));
          setActiveId(parsed[0].id);
          setIsMounted(true);
          return;
        }
      } catch {}
    }
    // 无数据时创建一个默认会话
    const defaultSession: Session = {
      id: uid(),
      title: DEFAULT_TITLE,
      pinned: false,
      updatedAt: Date.now(),
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
  // 保留 system prompt + (可选)压缩摘要 + 最近 MAX_CONTEXT_PAIRS 轮对话
  const trimContext = (msgs: Message[], summary?: string): Message[] => {
    const system = msgs.filter((m) => m.role === "system");
    const history = msgs.filter((m) => m.role !== "system");
    // 取最近 MAX_CONTEXT_PAIRS * 2 条（user + assistant 成对）
    const recent = history.slice(-MAX_CONTEXT_PAIRS * 2);
    const summaryMsg: Message[] = summary
      ? [
          {
            role: "system",
            content: `以下是之前对话的压缩摘要，请据此延续对话：\n${summary}`,
          },
        ]
      : [];
    return [...system, ...summaryMsg, ...recent];
  };

  // 手动压缩：把当前会话中除最近若干轮以外的历史交给 /api/compress 生成摘要
  const compressContext = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    const session = sessionsRef.current.find((s) => s.id === activeId);
    if (!session) return { ok: false, error: "no session" };

    const history = session.messages.filter((m) => m.role !== "system");
    // 保留最近 KEEP_RECENT_PAIRS 轮在 messages 里不参与压缩
    const KEEP_RECENT_PAIRS = 3;
    const keepCount = KEEP_RECENT_PAIRS * 2;
    if (history.length <= keepCount) {
      return { ok: false, error: "history too short to compress" };
    }
    const toCompress = history.slice(0, history.length - keepCount);

    try {
      const res = await fetch("/api/compress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toCompress,
          previousSummary: session.summary,
        }),
      });
      if (!res.ok) return { ok: false, error: `http ${res.status}` };
      const data = (await res.json()) as { summary?: string; error?: string };
      if (!data.summary) return { ok: false, error: data.error || "no summary" };

      // 把已压缩部分从 messages 中移除，留下 system + 最近 keepCount 条
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeId) return s;
          const sys = s.messages.filter((m) => m.role === "system");
          const hist = s.messages.filter((m) => m.role !== "system");
          const kept = hist.slice(-keepCount);
          return {
            ...s,
            messages: [...sys, ...kept],
            summary: data.summary,
            compressedUntil: (s.compressedUntil ?? 0) + toCompress.length,
            updatedAt: Date.now(),
          };
        })
      );
      return { ok: true };
    } catch (error) {
      console.error("Compress error:", error);
      return { ok: false, error: "request failed" };
    }
  }, [activeId]);

  // 发送消息
  const send = async (text: string) => {
    const controller = new AbortController();
    controllerRef.current = controller;

    const userMessage: Message = { role: "user", content: text };

    // 判定是否首轮：当前会话除 system 外没有任何消息，且标题仍为默认值
    const currentSession = sessionsRef.current.find((s) => s.id === activeId);
    const isFirstTurn =
      !!currentSession &&
      currentSession.messages.filter((m) => m.role !== "system").length === 0 &&
      currentSession.title === DEFAULT_TITLE;

    // 先更新 messages 和标题
    updateMessages((prev) => {
      const next = [...prev, userMessage, { role: "assistant", content: "" }];
      // 同步更新标题和时间，并重新排序让活跃会话上浮
      // titleGenerated 为 true 时（LLM 已生成或用户已重命名）不再覆盖
      setSessions((sessions) =>
        sortSessions(
          sessions.map((s) =>
            s.id === activeId
              ? {
                  ...s,
                  title: s.titleGenerated ? s.title : extractTitle(next),
                  updatedAt: Date.now(),
                }
              : s
          )
        )
      );
      return next;
    });

    setStreamingIndex(0);

    try {
      // 发送时截断 context（UI 中保留完整记录）
      const currentSummary = sessionsRef.current.find(
        (s) => s.id === activeId
      )?.summary;
      const trimmedMessages = trimContext(
        [...messages, userMessage],
        currentSummary
      );

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

      // 首轮回答完成后，调用 LLM 生成更精炼的标题
      if (isFirstTurn && assistantText.trim()) {
        generateTitle(activeId, text, assistantText);
      }
    } catch (error) {
      console.error("Send message error:", error);
    }
  };

  // 调用 /api/title 生成标题并写回会话
  const generateTitle = async (
    sessionId: string,
    userText: string,
    assistantText: string
  ) => {
    try {
      const res = await fetch("/api/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: userText,
          assistantMessage: assistantText,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { title?: string };
      const title = data.title?.trim();
      if (!title) return;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          // 飞行途中用户已手动命名，放弃覆盖
          if (s.titleGenerated) return s;
          return { ...s, title, titleGenerated: true };
        })
      );
    } catch (error) {
      console.error("Generate title error:", error);
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
      title: DEFAULT_TITLE,
      pinned: false,
      updatedAt: Date.now(),
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
    };
    setSessions((prev) => sortSessions([newSession, ...prev]));
    setActiveId(newSession.id);
  };

  // 切换会话
  const switchSession = (id: string) => {
    setActiveId(id);
    setStreamingIndex(null);
  };

  // 重命名会话
  const renameSession = (id: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, title, titleGenerated: true } : s
      )
    );
  };

  // 删除会话
  const deleteSession = (id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const defaultSession: Session = {
          id: uid(),
          title: DEFAULT_TITLE,
          pinned: false,
          updatedAt: Date.now(),
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

  // 置顶/取消置顶会话
  const togglePin = (id: string) => {
    setSessions((prev) => {
      const list = prev.map((s) =>
        s.id === id ? { ...s, pinned: !s.pinned } : s
      );
      return sortSessions(list);
    });
  };

  return {
    sessions,
    activeId,
    messages,
    summary,
    isMounted,
    bottomRef,
    streamingIndex,
    send,
    stop,
    clear: deleteSession,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    togglePin,
    compressContext,
  };
}
