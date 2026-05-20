'use client'

import MessageItem from "./components/MessageItem";
import InputArea from "./components/InputArea";
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
    deleteSession,
  } = useSession();

  return (
    <div className={styles.layout}>
      {/* 侧边栏 */}
      <aside className={styles.sidebar}>
        <button onClick={createSession} className={styles.newChatBtn}>
          + 新建会话
        </button>
        <div className={styles.sessionList}>
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`${styles.sessionItem} ${
                s.id === activeId ? styles.sessionItemActive : ""
              }`}
              onClick={() => switchSession(s.id)}
            >
              <span className={styles.sessionTitle}>{s.title}</span>
              <button
                className={styles.deleteBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.id);
                }}
              >
                ✕
              </button>
            </div>
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
