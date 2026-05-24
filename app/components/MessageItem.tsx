import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import CodeBlock from "./CodeBlock";
import styles from "./MessageItem.module.css";

interface MessageItemProps {
  role: "user" | "assistant";
  content: string;
  /** 是否启用代码高亮（streaming 中暂不高亮，结束后才高亮） */
  highlighted?: boolean;
}

// 把 content 按 ``` 围栏边界切成段:
// - 围栏前的纯文本/已闭合的代码块 → closed=true,内容稳定,memo 命中
// - 末尾(可能是未闭合的代码块或还在写的文本) → closed=false,每帧重解析但体积小
function splitMarkdownSegments(
  content: string
): { text: string; closed: boolean }[] {
  const segments: { text: string; closed: boolean }[] = [];
  const lines = content.split("\n");
  let buf: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const isFence = /^```/.test(line);
    if (isFence) {
      if (inFence) {
        // 闭合围栏
        buf.push(line);
        segments.push({ text: buf.join("\n"), closed: true });
        buf = [];
        inFence = false;
      } else {
        // 打开围栏：把之前累积的纯文本作为已闭合段落 flush 掉
        if (buf.length > 0) {
          segments.push({ text: buf.join("\n"), closed: true });
          buf = [];
        }
        buf.push(line);
        inFence = true;
      }
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) {
    segments.push({ text: buf.join("\n"), closed: false });
  }
  return segments;
}

const markdownComponents = {
  code({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement> & { highlighted?: boolean }) {
    // ReactMarkdown 不再传 inline,通过 language- className 区分块/行内
    const match = /language-(\w+)/.exec(className || "");
    if (match) {
      return (
        <CodeBlock
          language={match[1]}
          code={String(children).replace(/\n$/, "")}
          highlighted={props.highlighted}
        />
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

// 单段 markdown：text 不变 + highlighted 不变时直接跳过重渲染
const MarkdownSegment = memo(function MarkdownSegment({
  text,
  highlighted,
}: {
  text: string;
  highlighted: boolean;
}) {
  const components = useMemo(
    () => ({
      code: (p: React.HTMLAttributes<HTMLElement>) =>
        markdownComponents.code({ ...p, highlighted }),
    }),
    [highlighted]
  );
  return <ReactMarkdown components={components}>{text}</ReactMarkdown>;
});

const MessageItem = memo(function MessageItem({
  role,
  content,
  highlighted = true,
}: MessageItemProps) {
  const segments = useMemo(() => splitMarkdownSegments(content), [content]);
  return (
    <div className={styles.item}>
      <b>{role === "user" ? "你" : "AI"}:</b>

      <div className={styles.content}>
        {segments.map((seg, i) => (
          <MarkdownSegment
            key={i}
            text={seg.text}
            highlighted={highlighted}
          />
        ))}
      </div>
    </div>
  );
});

export default MessageItem;
