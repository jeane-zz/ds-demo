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
  console.log(role, content,);
  return (
    <div className={styles.item}>
      <b>{role === "user" ? "你" : "AI"}:</b>

      <div className={styles.content}>
        <ReactMarkdown
          components={{
            code({ inline, className, children, ...props }) {
             
              // 提取语言标识
              // 正则表达式匹配 language- 开头的内容 
              // Markdown里面 ```js 的className 标记为 language-js
              const match = /language-(\w+)/.exec(className || "");

              if (!inline && match) {
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
