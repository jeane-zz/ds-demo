"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { storage, type Session, type Message } from "../lib/storage";
import { TaskQueue } from "../lib/taskQueue";
import { migrateFromLocalStorage, checkMigrationStatus } from "../lib/migrate";

/** 旧版 localStorage 会话迁移到 SQLite 的进度状态 */
export type MigrationState =
  | { status: "idle" }
  | { status: "migrating" }
  | { status: "done"; count: number }
  | { status: "error"; error: string };

const SYSTEM_PROMPT = `你是一名经验丰富的全栈开发助手，擅长前端（React、Vue、TypeScript、CSS）、后端（Node.js、Python、数据库设计）、DevOps 与系统架构。你的目标是帮助用户高效地解决开发问题。

工作准则：
1. 直接回答问题，避免冗长的客套
2. 给出可运行的代码示例，并标注语言类型
3. 指出潜在的边界情况、性能问题或安全隐患
4. 涉及最佳实践时，简要说明原因和权衡
5. 不确定时主动询问，不编造 API 或库

输出格式：
- 使用 Markdown 排版，代码用 \`\`\` 包裹并标注语言
- 复杂方案分步骤说明
- 引用文件路径时使用 \`path/to/file.ext\` 格式`;
const MAX_CONTEXT_PAIRS = 15;
const DEFAULT_TITLE = "新会话";

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function toChatMessages(messages: Message[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function extractTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return DEFAULT_TITLE;
  const title = firstUser.content.replace(/[\n\r]/g, " ").trim();
  return title.length > 20 ? title.slice(0, 20) + "…" : title;
}

function sortSessions(list: Session[]): Session[] {
  return [...list].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

function createDefaultSession(): Session {
  const now = Date.now();
  return {
    id: uid(),
    title: DEFAULT_TITLE,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

function createMessage(
  sessionId: string,
  role: Message["role"],
  content: string,
  offset = 0
): Message {
  return {
    id: `${sessionId}-${uid()}`,
    sessionId,
    role,
    content,
    createdAt: Date.now() + offset,
  };
}

export function useSessionWithDB() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);
  const [migration, setMigration] = useState<MigrationState>({ status: "idle" });

  const controllerRef = useRef<AbortController | null>(null);
  const sessionsRef = useRef<Session[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const activeIdRef = useRef("");
  const queueRef = useRef<TaskQueue>(null as unknown as TaskQueue);
  if (queueRef.current === null) queueRef.current = new TaskQueue();
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeId);
  const summary = activeSession?.summary;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // 初始化：迁移旧数据 → 从数据库加载会话
  useEffect(() => {
    const init = async () => {
      try {
        // 首次进入时，把遗留的 localStorage 会话迁移到 SQLite
        if (!checkMigrationStatus()) {
          setMigration({ status: "migrating" });
          const result = await migrateFromLocalStorage();
          if (result.success) {
            setMigration({ status: "done", count: result.count });
          } else {
            // 迁移失败不阻断使用，仅记录并提示
            setMigration({
              status: "error",
              error: result.error ?? "Unknown error",
            });
            console.error("Legacy migration failed:", result.error);
          }
        }

        const allSessions = await storage.getAllSessions();
        if (allSessions.length > 0) {
          const sorted = sortSessions(allSessions);
          setSessions(sorted);
          setActiveId(sorted[0].id);
          const msgs = await storage.getMessages(sorted[0].id);
          setMessages(msgs);
        } else {
          // 创建默认会话
          const defaultSession = createDefaultSession();
          await storage.createSession(defaultSession);

          const systemMsg = createMessage(defaultSession.id, "system", SYSTEM_PROMPT);
          await storage.createMessage(systemMsg);

          setSessions([defaultSession]);
          setActiveId(defaultSession.id);
          setMessages([systemMsg]);
        }
      } catch (error) {
        console.error('Failed to initialize sessions:', error);
      } finally {
        setIsMounted(true);
      }
    };
    init();
  }, []);

  // 切换会话时加载消息
  useEffect(() => {
    if (!activeId || !isMounted) return;

    const loadMessages = async () => {
      try {
        const msgs = await storage.getMessages(activeId);
        setMessages(msgs);
      } catch (error) {
        console.error('Failed to load messages:', error);
      }
    };
    loadMessages();
  }, [activeId, isMounted]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  };

  const scrollToBottomSmooth = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const trimContext = (msgs: Message[], summary?: string): Message[] => {
    const system = msgs.filter((m) => m.role === "system");
    const history = msgs.filter((m) => m.role !== "system");
    const recent = history.slice(-MAX_CONTEXT_PAIRS * 2);
    const summaryMsg: Message[] = summary
      ? [
          {
            id: `${activeId}-summary`,
            sessionId: activeId,
            role: "system",
            content: `以下是之前对话的压缩摘要，请据此延续对话：\n${summary}`,
            createdAt: Date.now(),
          },
        ]
      : [];
    return [...system, ...summaryMsg, ...recent];
  };

  const createSession = useCallback(async () => {
    const newSession = createDefaultSession();

    try {
      await storage.createSession(newSession);

      const systemMsg = createMessage(newSession.id, "system", SYSTEM_PROMPT);
      await storage.createMessage(systemMsg);

      setSessions((prev) => sortSessions([newSession, ...prev]));
      setActiveId(newSession.id);
      setMessages([systemMsg]);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, []);

  const switchSession = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const renameSession = useCallback(async (id: string, title: string) => {
    try {
      const updatedAt = Date.now();
      await storage.updateSession(id, { title, titleGenerated: true, updatedAt });
      setSessions((prev) =>
        sortSessions(
          prev.map((s) =>
            s.id === id ? { ...s, title, titleGenerated: true, updatedAt } : s
          )
        )
      );
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await storage.deleteSession(id);
      const filtered = sessionsRef.current.filter((s) => s.id !== id);

      if (filtered.length === 0) {
        const defaultSession = createDefaultSession();
        const systemMsg = createMessage(defaultSession.id, "system", SYSTEM_PROMPT);
        await storage.createSession(defaultSession);
        await storage.createMessage(systemMsg);
        setSessions([defaultSession]);
        setActiveId(defaultSession.id);
        setMessages([systemMsg]);
        return;
      }

      const sorted = sortSessions(filtered);
      setSessions(sorted);
      if (id === activeIdRef.current) {
        setActiveId(sorted[0].id);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, []);

  const togglePin = useCallback(async (id: string) => {
    const session = sessionsRef.current.find((s) => s.id === id);
    if (!session) return;

    try {
      const updatedAt = Date.now();
      await storage.updateSession(id, { pinned: !session.pinned, updatedAt });
      setSessions((prev) =>
        sortSessions(
          prev.map((s) =>
            s.id === id ? { ...s, pinned: !s.pinned, updatedAt } : s
          )
        )
      );
    } catch (error) {
      console.error('Failed to toggle pin:', error);
    }
  }, []);

  const send = useCallback(async (userMessage: string) => {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;

    const controller = new AbortController();
    controllerRef.current = controller;

    const userMsg = createMessage(sessionId, "user", userMessage);
    const assistantMsg = createMessage(sessionId, "assistant", "", 1);
    const previousMessages = messagesRef.current;
    const nextMessages = [...previousMessages, userMsg, assistantMsg];
    const assistantVisibleIndex =
      nextMessages.filter((m) => m.role !== "system").length - 1;
    const currentSession = sessionsRef.current.find((s) => s.id === sessionId);
    const updatedAt = Date.now();
    const nextTitle =
      currentSession && !currentSession.titleGenerated
        ? extractTitle(nextMessages)
        : currentSession?.title;

    try {
      setMessages(nextMessages);
      setStreamingIndex(assistantVisibleIndex);
      if (currentSession) {
        setSessions((current) =>
          sortSessions(
            current.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    title: nextTitle ?? session.title,
                    updatedAt,
                  }
                : session
            )
          )
        );
      }
      await storage.bulkCreateMessages([userMsg, assistantMsg]);
      await storage.updateSession(sessionId, {
        ...(nextTitle ? { title: nextTitle } : {}),
        updatedAt,
      });

      await queueRef.current.run(async () => {
        if (controller.signal.aborted) {
          setStreamingIndex(null);
          return;
        }

        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: toChatMessages([...previousMessages, userMsg]),
            }),
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            throw new Error(`Chat request failed: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let assistantText = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            assistantText += decoder.decode(value, { stream: true });
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMsg.id
                  ? { ...message, content: assistantText }
                  : message
              )
            );
            scrollToBottom();
          }

          const tail = decoder.decode();
          if (tail) {
            assistantText += tail;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMsg.id
                  ? { ...message, content: assistantText }
                  : message
              )
            );
          }

          await storage.updateMessage(assistantMsg.id, { content: assistantText });
          scrollToBottomSmooth();
        } catch (error) {
          if (!controller.signal.aborted) {
            console.error('Failed to stream assistant response:', error);
          }
        } finally {
          setStreamingIndex(null);
        }
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      setStreamingIndex(null);
      setMessages(messagesRef.current);
    }
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setStreamingIndex(null);
  }, []);

  const regenerate = useCallback(async () => {
    console.log('Regenerate');
  }, []);

  const setVariant = useCallback(async (index: number) => {
    console.log('Set variant:', index);
  }, []);

  const compressContext = useCallback(async () => {
    return { ok: false, error: 'Not implemented' };
  }, []);

  return {
    sessions,
    activeId,
    messages,
    summary,
    isMounted,
    bottomRef,
    streamingIndex,
    migration,
    send,
    stop,
    regenerate,
    setVariant,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    togglePin,
    compressContext,
  };
}
