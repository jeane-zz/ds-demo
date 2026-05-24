import { memo } from "react";
import ReactMarkdown from "react-markdown";
import CodeBlock from "./CodeBlock";
import styles from "./MessageItem.module.css";

interface MessageItemProps {
  role: "user" | "assistant";
  content: string;
  /** 是否启用代码高亮（streaming 中暂不高亮，结束后才高亮） */
  highlighted?: boolean;
}

const MessageItem = memo(function MessageItem({
  role,
  content,
  highlighted = true,
}: MessageItemProps) {
  return (
    <div className={styles.item}>
      <b>{role === "user" ? "你" : "AI"}:</b>

      <div className={styles.content}>
        <ReactMarkdown
          components={{
            code({ className, children, ...props }) {
              // 新版 react-markdown 不再传 inline 属性。
              // 块级代码块在解析时会带上 language-xxx 的 className，
              // 行内代码没有 language- 前缀，以此区分。
              const match = /language-(\w+)/.exec(className || "");

              if (match) {
                return (
                  <CodeBlock
                    language={match[1]}
                    code={String(children).replace(/\n$/, "")}
                    highlighted={highlighted}
                  />
                );
              }

              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
});

export default MessageItem;
