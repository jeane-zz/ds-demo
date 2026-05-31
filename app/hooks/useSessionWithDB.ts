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

function extractTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return DEFAULT_TITLE;
  const title = firstUser.content.replace(/[\n\r]/g, " ").trim();
  return title.length > 20 ? title.slice(0, 20) + "…" : title;
}

export function useSessionWithDB() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);
  const [migration, setMigration] = useState<MigrationState>({ status: "idle" });

  const controllerRef = useRef<AbortController | null>(null);
  const queueRef = useRef<TaskQueue>(null as unknown as TaskQueue);
  if (queueRef.current === null) queueRef.current = new TaskQueue();
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeId);
  const summary = activeSession?.summary;

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
          setSessions(allSessions);
          setActiveId(allSessions[0].id);
          const msgs = await storage.getMessages(allSessions[0].id);
          setMessages(msgs);
        } else {
          // 创建默认会话
          const defaultSession: Session = {
            id: uid(),
            title: DEFAULT_TITLE,
            pinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await storage.createSession(defaultSession);

          const systemMsg: Message = {
            id: `${defaultSession.id}-0`,
            sessionId: defaultSession.id,
            role: "system",
            content: SYSTEM_PROMPT,
            createdAt: Date.now(),
          };
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
    const newSession: Session = {
      id: uid(),
      title: DEFAULT_TITLE,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await storage.createSession(newSession);

      const systemMsg: Message = {
        id: `${newSession.id}-0`,
        sessionId: newSession.id,
        role: "system",
        content: SYSTEM_PROMPT,
        createdAt: Date.now(),
      };
      await storage.createMessage(systemMsg);

      setSessions((prev) => [newSession, ...prev]);
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
      await storage.updateSession(id, { title, updatedAt: Date.now() });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s))
      );
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await storage.deleteSession(id);
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== id);
        if (id === activeId && filtered.length > 0) {
          setActiveId(filtered[0].id);
        }
        return filtered;
      });
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, [activeId]);

  const togglePin = useCallback(async (id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;

    try {
      await storage.updateSession(id, { pinned: !session.pinned });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s))
      );
    } catch (error) {
      console.error('Failed to toggle pin:', error);
    }
  }, [sessions]);

  const send = useCallback(
    async (userMessage: string) => {
      // 实现发送逻辑（简化版，完整实现需要复制原 useSession 的 streamAssistant 逻辑）
      console.log('Send:', userMessage);
    },
    [activeId, messages]
  );

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
