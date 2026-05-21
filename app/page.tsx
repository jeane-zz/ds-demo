'use client'

import { useState, useRef, useEffect } from "react";
import MessageItem from "./components/MessageItem";
import InputArea from "./components/InputArea";
import ThemeToggle from "./components/ThemeToggle";
import { useSession } from "./hooks/useSession";
import styles from "./page.module.css";

export default function Home() {
  const {
    sessions,
    activeId,
    messages,
    isMounted,
    bottomRef,
    streamingIndex,
    send,
    stop,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
  } = useSession();

  return (
    <div className={styles.layout}>
      {/* 侧边栏 */}
      <aside className={styles.sidebar}>
        <div className={styles.toolbar}>
          <button onClick={createSession} className={styles.newChatBtn}>
            + 新建会话
          </button>
          <ThemeToggle />
        </div>
        <div className={styles.sessionList}>
          {sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              isActive={s.id === activeId}
              onSelect={() => switchSession(s.id)}
              onRename={(title) => renameSession(s.id, title)}
              onDelete={() => deleteSession(s.id)}
            />
          ))}
        </div>
      </aside>

      {/* 主区域 */}
      <main className={styles.main}>
        <div className={styles.chatArea}>
          {isMounted &&
            messages
              .filter((msg) => msg.role !== "system")
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

      <InputArea onSend={send} onStop={stop} />
      </main>
    </div>
  );
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  session: { id: string; title: string };
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
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
      onRename(trimmed);
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
      onClick={onSelect}
    >
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
          onDelete();
        }}
      >
        ✕
      </button>
    </div>
  );
}
