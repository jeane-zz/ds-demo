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
          const assistantText = await streamAssistant(
            assistantMsg.id,
            [...previousMessages, userMsg],
            controller.signal
          );
          await storage.updateMessage(assistantMsg.id, { content: assistantText });
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
    // streamAssistant 仅闭包 refs 与稳定的 setState,其标识变化不影响行为;
    // 列入依赖会让 send 每次渲染都变,破坏 InputArea 的 props 稳定性。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setStreamingIndex(null);
  }, []);

  // 向 /api/chat 发请求 + rAF 节流流式写入指定 assistant 消息(按 id 定位)。
  // send 与 regenerate 共用此路径。调用方负责事先把空占位 assistant 放进 messages,
  // 并在结束后做持久化。返回最终拼接好的 assistant 文本。
  // 用函数声明而非 const,使其提升至 hook 作用域顶部,供上方的 send 引用。
  async function streamAssistant(
    targetId: string,
    msgsForApi: Message[],
    signal: AbortSignal
  ): Promise<string> {
    const sessionId = activeIdRef.current;
    const currentSummary = sessionsRef.current.find(
      (s) => s.id === sessionId
    )?.summary;
    const trimmedMessages = trimContext(msgsForApi, currentSummary);

    // ── Conversation RAG ──────────────────────────────────────────
    // 从全量历史中检索与当前用户问题最相关的消息，拼入 context
    let ragContext: { role: string; content: string }[] = [];
    let lastUserMsg: Message | undefined;
    try {
      const history = msgsForApi.filter((m) => m.role !== "system");

      lastUserMsg = [...history].reverse().find((m) => m.role === "user");
      if (lastUserMsg && history.length > 4) {
        const { retrieveRelevantContext } = await import(
          "../lib/conversationRag"
        );
        ragContext = await retrieveRelevantContext(
          sessionId,
          lastUserMsg.content,
          history
        );
      }
    } catch (e) {
      console.warn("对话 RAG 检索出错，跳过:", e);
    }

    // ── File RAG ──────────────────────────────────────────────────
    // 从已上传的 .txt / .md 文件中检索与当前问题相关的片段
    let fileRagContext: { role: string; content: string }[] = [];
    try {
      if (lastUserMsg) {
        const { searchFileChunks, indexFileChunks } = await import(
          "../lib/fileChunkRag"
        );

        // 如果当前消息包含文件内容，先异步建立索引（不阻塞回复）
        const filePattern = /`([^`]+)`:\n```\n([\s\S]*?)```/g;
        let match: RegExpExecArray | null;
        while ((match = filePattern.exec(lastUserMsg.content)) !== null) {
          const fName = match[1];
          const fContent = match[2];
          if (
            (fName.endsWith(".txt") || fName.endsWith(".md")) &&
            fContent.length > 0
          ) {
            Promise.resolve(
              indexFileChunks(sessionId, fName, fContent).catch((e) =>
                console.warn(`为 ${fName} 建立索引失败:`, e)
              )
            );
          }
        }

        // 检索文件 chunks
        const results = await searchFileChunks(
          lastUserMsg.content,
          sessionId,
          3,
          0.2
        );
        if (results.length > 0) {
          const contextText = results
            .map(
              (r) =>
                `[文件: ${r.fileName} (第 ${r.index + 1}/${r.total} 段)]\n${r.text}`
            )
            .join("\n\n---\n\n");
          fileRagContext = [
            {
              role: "system",
              content: `以下是用户上传文件中与当前问题相关的内容：\n\n${contextText}`,
            },
          ];
        }
      }
    } catch (e) {
      console.warn("文件 RAG 检索出错，跳过:", e);
    }

    // 组装最终消息：system(含压缩摘要) + Conversation RAG + File RAG + 最近对话
    const system = trimmedMessages.filter((m) => m.role === "system");
    const summaryMsgs = trimmedMessages.filter(
      (m) => m.role !== "system" && m.content.startsWith("以下是之前对话的")
    );
    const recent = trimmedMessages.filter(
      (m) => m.role !== "system" && !m.content.startsWith("以下是之前对话的")
    );

    const finalMessages = [
      ...toChatMessages(system),
      ...ragContext,
      ...fileRagContext,
      ...toChatMessages(summaryMsgs),
      ...toChatMessages(recent),
    ];
    // ────────────────────────────────────────────────────────────────

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: finalMessages }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = "";

    let pendingText = "";
    let rafId: number | null = null;
    let hasPending = false;

    const flush = () => {
      if (!hasPending) return;
      const snapshot = pendingText;
      hasPending = false;
      setMessages((current) =>
        current.map((message) =>
          message.id === targetId
            ? { ...message, content: snapshot }
            : message
        )
      );
      scrollToBottom();
    };

    const scheduleFlush = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        flush();
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        assistantText += decoder.decode(value, { stream: true });
        pendingText = assistantText;
        hasPending = true;
        scheduleFlush();
      }
      const tail = decoder.decode();
      if (tail) {
        assistantText += tail;
        pendingText = assistantText;
        hasPending = true;
      }
    } finally {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flush();
    }

    scrollToBottomSmooth();
    return assistantText;
  }

  // 重新生成最后一条 assistant 回复:把当前 content 收纳进 variants,新增空占位
  // 作为新版本并激活,流式写完后把最终文本写回 variants[activeVariant] 并持久化。
  const regenerate = useCallback(async () => {
    const msgs = messagesRef.current;
    if (msgs.length < 2) return;
    const last = msgs[msgs.length - 1];
    const prev = msgs[msgs.length - 2];
    if (last.role !== "assistant" || prev.role !== "user") return;

    const controller = new AbortController();
    controllerRef.current = controller;

    const existing = last.variants ?? [last.content];
    const nextVariants = [...existing, ""];
    const activeVariant = nextVariants.length - 1;

    // 乐观更新:占位空 content + 新变体
    setMessages((m) => {
      const cloned = [...m];
      const tail = cloned[cloned.length - 1];
      if (tail.id !== last.id) return m;
      cloned[cloned.length - 1] = {
        ...tail,
        content: "",
        variants: nextVariants,
        activeVariant,
      };
      return cloned;
    });

    const visibleCount = msgs.filter((m) => m.role !== "system").length;
    setStreamingIndex(visibleCount - 1);

    return queueRef.current.run(async () => {
      if (controller.signal.aborted) {
        setStreamingIndex(null);
        return;
      }
      try {
        // 先持久化占位(变体数组 + 激活索引)
        await storage.updateMessage(last.id, {
          content: "",
          variants: nextVariants,
          activeVariant,
        });

        // 发给 API 的历史不含被重生成的占位 assistant,只到上一条 user 为止
        const finalText = await streamAssistant(
          last.id,
          msgs.slice(0, -1),
          controller.signal
        );

        const finalVariants = [...nextVariants];
        finalVariants[activeVariant] = finalText;

        setMessages((m) => {
          const cloned = [...m];
          const tail = cloned[cloned.length - 1];
          if (tail.id !== last.id || !tail.variants) return m;
          cloned[cloned.length - 1] = {
            ...tail,
            content: finalText,
            variants: finalVariants,
            activeVariant,
          };
          return cloned;
        });

        await storage.updateMessage(last.id, {
          content: finalText,
          variants: finalVariants,
          activeVariant,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Regenerate error:", error);
        }
      } finally {
        setStreamingIndex(null);
      }
    });
    // streamAssistant 仅闭包 refs 与稳定的 setState,其标识变化不影响行为;
    // 列入依赖会让 regenerate 每次渲染都变,破坏 MessageItem 的 memo。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换最后一条 assistant 消息的版本:更新 content 与 activeVariant 并持久化
  const setVariant = useCallback(async (index: number) => {
    const msgs = messagesRef.current;
    if (msgs.length === 0) return;
    const tail = msgs[msgs.length - 1];
    if (
      tail.role !== "assistant" ||
      !tail.variants ||
      index < 0 ||
      index >= tail.variants.length
    ) {
      return;
    }

    const content = tail.variants[index];
    setMessages((m) => {
      const cloned = [...m];
      const t = cloned[cloned.length - 1];
      if (t.id !== tail.id || !t.variants) return m;
      cloned[cloned.length - 1] = {
        ...t,
        content,
        activeVariant: index,
      };
      return cloned;
    });

    try {
      // content 列与 activeVariant 一并持久化,避免重载后两者不一致
      // (getBySessionId 用 content 列还原显示文本,而非 variants[activeVariant])
      await storage.updateMessage(tail.id, { content, activeVariant: index });
    } catch (error) {
      console.error("Failed to set variant:", error);
    }
  }, []);

  // 手动压缩:把除最近若干轮以外的历史交给 /api/compress 生成摘要,
  // 用 bulkReplaceMessages 删减已压缩历史,并持久化 summary / compressedUntil。
  const compressContext = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    return queueRef.current.run(async () => {
      const sessionId = activeIdRef.current;
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return { ok: false, error: "no session" };

      const allMessages = messagesRef.current;
      const history = allMessages.filter((m) => m.role !== "system");
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
            messages: toChatMessages(toCompress),
            previousSummary: session.summary,
          }),
        });
        if (!res.ok) return { ok: false, error: `http ${res.status}` };
        const data = (await res.json()) as { summary?: string; error?: string };
        const newSummary = data.summary;
        if (!newSummary) return { ok: false, error: data.error || "no summary" };

        // 留下 system + 最近 keepCount 条,其余替换掉
        const sys = allMessages.filter((m) => m.role === "system");
        const kept = history.slice(-keepCount);
        const nextMessages = [...sys, ...kept];
        const updatedAt = Date.now();
        const compressedUntil =
          (session.compressedUntil ?? 0) + toCompress.length;

        await storage.bulkReplaceMessages(sessionId, nextMessages);
        await storage.updateSession(sessionId, {
          summary: newSummary,
          compressedUntil,
          updatedAt,
        });

        setMessages(nextMessages);
        setSessions((prev) =>
          sortSessions(
            prev.map((s) =>
              s.id === sessionId
                ? { ...s, summary: newSummary, compressedUntil, updatedAt }
                : s
            )
          )
        );
        return { ok: true };
      } catch (error) {
        console.error("Compress error:", error);
        return { ok: false, error: "request failed" };
      }
    });
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
