"use client";

import { memo, useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeBlockProps {
  language: string;
  code: string;
  /** 是否启用高亮（streaming 中暂不高亮） */
  highlighted?: boolean;
}

const CodeBlock = memo(function CodeBlock({
  language,
  code,
  highlighted = true,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div style={{ position: "relative", margin: "8px 0" }}>
      {/* 顶栏：语言标签 + 复制按钮 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#3a3f4b",
          color: "#abb2bf",
          fontSize: 12,
          padding: "4px 12px",
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
        }}
      >
        <span>{language}</span>
        <button
          onClick={handleCopy}
          style={{
            background: "none",
            border: "none",
            color: copied ? "#98c379" : "#abb2bf",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 6px",
          }}
        >
          {copied ? "✓ 已复制" : "📋 复制"}
        </button>
      </div>

      {/* 代码内容 */}
      {highlighted ? (
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          customStyle={{ margin: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
        >
          {code.replace(/\n$/, "")}
        </SyntaxHighlighter>
      ) : (
        <pre
          style={{
            background: "#282c34",
            color: "#abb2bf",
            padding: "16px",
            margin: 0,
            overflowX: "auto",
            fontSize: 14,
            borderBottomLeftRadius: 6,
            borderBottomRightRadius: 6,
          }}
        >
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});

export default CodeBlock;
