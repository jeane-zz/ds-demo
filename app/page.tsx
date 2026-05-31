'use client'

import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import Link from "next/link";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import MessageItem from "./components/MessageItem";
import InputArea from "./components/InputArea";
import ThemeToggle from "./components/ThemeToggle";
import { MessageSearch } from "./components/MessageSearch";
import { useSessionWithDB } from "./hooks/useSessionWithDB";
import styles from "./page.module.css";

// 超过该条数后启用虚拟化渲染
const VIRTUALIZE_THRESHOLD = 30;

export default function Home() {
  const {
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
  } = useSessionWithDB();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(debouncedSearch.toLowerCase())
  );

  // 给 SessionItem 用的稳定 handler：把 id 作为参数传入,
  // 这样父级回调引用在跨渲染时保持不变，配合 memo(SessionItem) 才能跳过未变项。
  const handleSelectSession = useCallback(
    (id: string) => switchSession(id),
    [switchSession]
  );
  const handleRenameSession = useCallback(
    (id: string, title: string) => renameSession(id, title),
    [renameSession]
  );
  const handleDeleteSession = useCallback(
    (id: string) => deleteSession(id),
    [deleteSession]
  );
  const handleTogglePinSession = useCallback(
    (id: string) => togglePin(id),
    [togglePin]
  );

  // 可见消息（剔除 system），既用于 Virtuoso 也用于普通分支
  const visibleMessages = useMemo(
    () => messages.filter((msg) => msg.role !== "system"),
    [messages]
  );
  const useVirtual = visibleMessages.length > VIRTUALIZE_THRESHOLD;

  // 最后一条 assistant 在 visibleMessages 里的索引(没有则为 -1);
  // 用于决定哪条消息显示「重新生成」按钮。streaming 中不显示。
  const lastAssistantIndex = useMemo(() => {
    if (streamingIndex !== null) return -1;
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === "assistant") return i;
    }
    return -1;
  }, [visibleMessages, streamingIndex]);

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const handleSelectResult = useCallback(
    (id: string) => {
      const index = parseInt(id.split("-").pop() ?? "", 10);
      if (isNaN(index)) return;
      if (useVirtual) {
        virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "smooth" });
      } else {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [useVirtual]
  );

  // 切换会话或新建会话时，跳到底部一次（仅虚拟化分支需要）
  useEffect(() => {
    if (!useVirtual) return;
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
    });
  }, [activeId, useVirtual]);

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navItem + ' ' + styles.navItemActive}>
            💬 对话
          </Link>
          <Link href="/docs" className={styles.navItem}>
            📚 文档
          </Link>
        </nav>
        <ThemeToggle />
      </header>

      {migration.status === "migrating" && (
        <div className={styles.migrationBanner}>正在迁移历史会话到本地数据库…</div>
      )}
      {migration.status === "done" && migration.count > 0 && (
        <div className={styles.migrationBanner}>
          已迁移 {migration.count} 个历史会话到本地数据库
        </div>
      )}
      {migration.status === "error" && (
        <div className={`${styles.migrationBanner} ${styles.migrationBannerError}`}>
          历史会话迁移失败：{migration.error}
        </div>
      )}

      <div className={styles.layout}>
      {/* 侧边栏 */}
      <aside className={styles.sidebar}>
        <div className={styles.toolbar}>
          <button onClick={createSession} className={styles.newChatBtn}>
            + 新建会话
          </button>
        </div>
        <input
          className={styles.searchInput}
          placeholder="搜索会话..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* 消息语义搜索 */}
        <MessageSearch
          sessionId={activeId}
          messages={visibleMessages.map((m, i) => ({
            id: `${activeId}-${i}`,
            text: m.content,
          }))}
          onSelectResult={handleSelectResult}
        />

        <div className={styles.sessionList}>
          {filteredSessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              isActive={s.id === activeId}
              onSelect={handleSelectSession}
              onRename={handleRenameSession}
              onDelete={handleDeleteSession}
              onTogglePin={handleTogglePinSession}
            />
          ))}
        </div>
      </aside>

      {/* 主区域 */}
      <main className={styles.main}>
        <div
          className={`${styles.chatArea} ${
            useVirtual ? styles.chatAreaVirtual : ""
          }`}
        >
          {isMounted && !useVirtual && (
            <>
              {visibleMessages.map((msg, index) => (
                <div key={index} id={`${activeId}-${index}`}>
                <MessageItem
                  role={msg.role as "user" | "assistant"}
                  content={msg.content}
                  highlighted={
                    streamingIndex === null || index !== streamingIndex
                  }
                  canRegenerate={index === lastAssistantIndex}
                  onRegenerate={regenerate}
                  variantIndex={
                    index === lastAssistantIndex ? msg.activeVariant : undefined
                  }
                  variantCount={
                    index === lastAssistantIndex
                      ? msg.variants?.length
                      : undefined
                  }
                  onSelectVariant={
                    index === lastAssistantIndex ? setVariant : undefined
                  }
                />
                </div>
              ))}
              <div ref={bottomRef}></div>
            </>
          )}
          {isMounted && useVirtual && (
            <Virtuoso
              ref={virtuosoRef}
              style={{ height: "100%" }}
              data={visibleMessages}
              followOutput="auto"
              initialTopMostItemIndex={Math.max(0, visibleMessages.length - 1)}
              computeItemKey={(index) => `${activeId}-${index}`}
              itemContent={(index, msg) => (
                <div className={styles.virtualItem}>
                  <MessageItem
                    role={msg.role as "user" | "assistant"}
                    content={msg.content}
                    highlighted={
                      streamingIndex === null || index !== streamingIndex
                    }
                    canRegenerate={index === lastAssistantIndex}
                    onRegenerate={regenerate}
                    variantIndex={
                      index === lastAssistantIndex
                        ? msg.activeVariant
                        : undefined
                    }
                    variantCount={
                      index === lastAssistantIndex
                        ? msg.variants?.length
                        : undefined
                    }
                    onSelectVariant={
                      index === lastAssistantIndex ? setVariant : undefined
                    }
                  />
                </div>
              )}
            />
          )}
      </div>

      <InputArea
        onSend={send}
        onStop={stop}
        onCompress={compressContext}
        messages={messages}
        summary={summary}
        sessionId={activeId}
      />
      </main>
      </div>
    </div>
  );
}

const SessionItem = memo(function SessionItem({
  session,
  isActive,
  onSelect,
  onRename,
  onDelete,
  onTogglePin,
}: {
  session: { id: string; title: string; pinned?: boolean };
  isActive: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const handleDoubleClick = () => {
    setDraft(session.title);
    setEditing(true);
  };

  const handleSubmit = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      onRename(session.id, trimmed);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  };

  return (
    <div
      className={`${styles.sessionItem} ${
        isActive ? styles.sessionItemActive : ""
      }`}
      onClick={() => onSelect(session.id)}
    >
      <button
        className={`${styles.pinBtn} ${session.pinned ? styles.pinBtnActive : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(session.id);
        }}
      >
        📌
      </button>
      {editing ? (
        <input
          ref={inputRef}
          className={styles.renameInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className={styles.sessionTitle} onDoubleClick={handleDoubleClick}>
          {session.title}
        </span>
      )}
      <button
        className={styles.deleteBtn}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
      >
        ✕
      </button>
    </div>
  );
},
// SessionItem 只用 session.{id,title,pinned}，不要对整个 session 做引用比较。
// 这样发送消息时 active session 引用变了但显示字段没变,仍能跳过重渲染。
(prev, next) =>
  prev.isActive === next.isActive &&
  prev.session.id === next.session.id &&
  prev.session.title === next.session.title &&
  prev.session.pinned === next.session.pinned &&
  prev.onSelect === next.onSelect &&
  prev.onRename === next.onRename &&
  prev.onDelete === next.onDelete &&
  prev.onTogglePin === next.onTogglePin);
