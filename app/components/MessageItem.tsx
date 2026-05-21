import { memo } from "react";
import ReactMarkdown from "react-markdown";
import CodeBlock from "./CodeBlock";

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
    <div style={{ marginBottom: 20 }}>
      <b>{role === "user" ? "你" : "AI"}:</b>

      <div
        style={{
          whiteSpace: "pre-wrap",
          marginTop: 8,
        }}
      >
        <ReactMarkdown
          components={{
            code({ inline, className, children, ...props }) {
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
