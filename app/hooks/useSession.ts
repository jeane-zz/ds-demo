"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { TaskQueue } from "../lib/taskQueue";

export interface Message {
  role: string;
  content: string;
  // 仅 assistant 消息使用:存所有历史版本与当前激活索引。
  // 第一次 regenerate 时把原 content 作为 variants[0] 存下,新回复 push 进来。
  variants?: string[];
  activeVariant?: number;
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

  // 串行化所有会话变更动作:send / compress / generateTitle 走同一队列,
  // 避免 streaming 进行中执行 compress 时出现 messages 切片错位等竞态。
  const queueRef = useRef<TaskQueue>(null as unknown as TaskQueue);
  if (queueRef.current === null) queueRef.current = new TaskQueue();

  // 底部 DOM 引用
  const bottomRef = useRef<HTMLDivElement>(null);

  // 记录正在 streaming 的消息索引
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null);

  // 当前会话的 messages（派生）
  const activeSession = sessions.find((s) => s.id === activeId);
  const messages = activeSession?.messages ?? [];
  const summary = activeSession?.summary;

  // 组件挂载后从 localStorage 恢复
  // SSR 下 localStorage 不可用，且需要保持 hydration 一致（page.tsx 用 isMounted
  // 守卫消息渲染），所以初始化必须在 effect 中完成 — 这里的 setState 不是从 props
  // 派生 state，而是从外部系统加载初值，规则在该场景没有更轻量的等价方案。
  /* eslint-disable react-hooks/set-state-in-effect */
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
  /* eslint-enable react-hooks/set-state-in-effect */

  // 用 ref 跟踪最新 sessions，防抖写入 localStorage
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  });

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
  const compressContext = useCallback((): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    return queueRef.current.run(async () => {
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
        if (!data.summary)
          return { ok: false, error: data.error || "no summary" };

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
    });
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

    // 全部网络/streaming 走任务队列,保证和 compress / generateTitle 串行
    return queueRef.current.run(async () => {
      // 任务真正调度到时,如果用户已经在队列里点了 Stop,则跳过发送
      if (controller.signal.aborted) {
        setStreamingIndex(null);
        return;
      }
      try {
        const assistantText = await streamAssistant(
          [...messages, userMessage],
          controller.signal
        );
        if (isFirstTurn && assistantText.trim()) {
          generateTitle(activeId, text, assistantText);
        }
      } catch (error) {
        console.error("Send message error:", error);
      }
    });
  };

  // 把「向 /api/chat 发请求 + rAF 节流流式写入最后一条 assistant 消息」抽出来,
  // send 和 regenerate 都走这条路径。返回最终拼接好的 assistant 文本。
  // 调用方负责事先把最后一条 assistant 占位消息(content="")放到 messages 末尾。
  const streamAssistant = async (
    msgsForApi: Message[],
    signal: AbortSignal
  ): Promise<string> => {
    const currentSummary = sessionsRef.current.find(
      (s) => s.id === activeId
    )?.summary;
    const trimmedMessages = trimContext(msgsForApi, currentSummary);

    // ── Conversation RAG ──────────────────────────────────────────
    // 从全量历史中检索与当前用户问题最相关的消息，拼入 context
    let ragContext: Message[] = [];
    let lastUserMsg: Message | undefined;
    try {
      const history = msgsForApi.filter((m) => m.role !== "system");

      lastUserMsg = [...history].reverse().find((m) => m.role === "user");
      if (lastUserMsg && history.length > 4) {
        const { retrieveRelevantContext } = await import(
          "../lib/conversationRag"
        );
        ragContext = await retrieveRelevantContext(activeId, lastUserMsg.content, history);
      }
    } catch (e) {
      console.warn("对话 RAG 检索出错，跳过:", e);
    }

    // ── File RAG ──────────────────────────────────────────────────
    // 从已上传的 .txt / .md 文件中检索与当前问题相关的片段
    let fileRagContext: Message[] = [];
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
              indexFileChunks(activeId, fName, fContent).catch((e) =>
                console.warn(`为 ${fName} 建立索引失败:`, e)
              )
            );
          }
        }

        // 检索文件 chunks
        const results = await searchFileChunks(lastUserMsg.content, activeId, 3, 0.2);
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

    // 组装最终消息：system + Conversation RAG + File RAG + 压缩摘要 + 最近对话
    const system = trimmedMessages.filter((m) => m.role === "system");
    const summary = trimmedMessages.filter(
      (m) => m.role !== "system" && m.content.startsWith("以下是之前对话的")
    );
    const recent = trimmedMessages.filter(
      (m) => m.role !== "system" && !m.content.startsWith("以下是之前对话的")
    );

    const finalMessages = [...system, ...ragContext, ...fileRagContext, ...summary, ...recent];
    // ────────────────────────────────────────────────────────────────

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: finalMessages }),
      signal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let assistantText = "";

    let pendingText = "";
    let rafId: number | null = null;
    let hasPending = false;

    const flush = () => {
      if (!hasPending) return;
      const snapshot = pendingText;
      hasPending = false;
      updateMessages((prev) => {
        const cloned = [...prev];
        const tail = cloned[cloned.length - 1];
        // spread tail 而不是整体覆盖,以保留 regenerate 在占位时写入的
        // variants / activeVariant 字段;send 路径下 tail 没有这两个字段也不受影响。
        cloned[cloned.length - 1] = {
          ...tail,
          role: "assistant",
          content: snapshot,
        };
        return cloned;
      });
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
    setStreamingIndex(null);
    return assistantText;
  };

  // 重新生成最后一条 assistant 回复:保留旧版本,在 variants 末尾追加一个空占位
  // 作为新版本,流式写完后把 content 同步回 variants[activeVariant]。
  const regenerate = async () => {
    const session = sessionsRef.current.find((s) => s.id === activeId);
    if (!session) return;
    const msgs = session.messages;
    if (msgs.length < 2) return;
    const last = msgs[msgs.length - 1];
    const prev = msgs[msgs.length - 2];
    if (last.role !== "assistant" || prev.role !== "user") return;

    const controller = new AbortController();
    controllerRef.current = controller;

    // 把当前 content 收纳进 variants,新增一个空占位作为新版本并激活它
    updateMessages((m) => {
      const cloned = [...m];
      const tail = cloned[cloned.length - 1];
      const existing = tail.variants ?? [tail.content];
      const nextVariants = [...existing, ""];
      cloned[cloned.length - 1] = {
        role: "assistant",
        content: "",
        variants: nextVariants,
        activeVariant: nextVariants.length - 1,
      };
      return cloned;
    });
    setStreamingIndex(0);

    return queueRef.current.run(async () => {
      if (controller.signal.aborted) {
        setStreamingIndex(null);
        return;
      }
      try {
        // 发给 API 的历史不包含被重生成的占位 assistant,只到上一条 user 为止
        const finalText = await streamAssistant(
          msgs.slice(0, -1),
          controller.signal
        );
        // 把最终文本写回 variants[activeVariant],保持 content 与之同步
        updateMessages((m) => {
          const cloned = [...m];
          const tail = cloned[cloned.length - 1];
          if (!tail.variants || tail.activeVariant === undefined) return m;
          const nextVariants = [...tail.variants];
          nextVariants[tail.activeVariant] = finalText;
          cloned[cloned.length - 1] = {
            ...tail,
            content: finalText,
            variants: nextVariants,
          };
          return cloned;
        });
      } catch (error) {
        console.error("Regenerate error:", error);
      }
    });
  };

  // 切换最后一条 assistant 消息的版本
  const setVariant = useCallback(
    (index: number) => {
      updateMessages((m) => {
        if (m.length === 0) return m;
        const tail = m[m.length - 1];
        if (
          tail.role !== "assistant" ||
          !tail.variants ||
          index < 0 ||
          index >= tail.variants.length
        )
          return m;
        const cloned = [...m];
        cloned[cloned.length - 1] = {
          ...tail,
          content: tail.variants[index],
          activeVariant: index,
        };
        return cloned;
      });
    },
    [updateMessages]
  );

  // 调用 /api/title 生成标题并写回会话
  const generateTitle = (
    sessionId: string,
    userText: string,
    assistantText: string
  ) => {
    queueRef.current.run(async () => {
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
    });
  };

  // 停止
  const stop = () => {
    controllerRef.current?.abort();
    setStreamingIndex(null);
  };

  // 新建会话
  const createSession = useCallback(() => {
    const newSession: Session = {
      id: uid(),
      title: DEFAULT_TITLE,
      pinned: false,
      updatedAt: Date.now(),
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
    };
    setSessions((prev) => sortSessions([newSession, ...prev]));
    setActiveId(newSession.id);
  }, []);

  // 切换会话
  const switchSession = useCallback((id: string) => {
    setActiveId(id);
    setStreamingIndex(null);
  }, []);

  // 重命名会话
  const renameSession = useCallback((id: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, title, titleGenerated: true } : s
      )
    );
  }, []);

  // 删除会话
  const deleteSession = useCallback((id: string) => {
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
      // 用 setActiveId 的函数式更新避免依赖 activeId，让回调引用保持稳定
      setActiveId((current) => (current === id ? filtered[0].id : current));
      return filtered;
    });
  }, []);

  // 置顶/取消置顶会话
  const togglePin = useCallback((id: string) => {
    setSessions((prev) => {
      const list = prev.map((s) =>
        s.id === id ? { ...s, pinned: !s.pinned } : s
      );
      return sortSessions(list);
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
    send,
    stop,
    regenerate,
    setVariant,
    clear: deleteSession,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    togglePin,
    compressContext,
  };
}
