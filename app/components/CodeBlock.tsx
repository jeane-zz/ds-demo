"use client";

import { memo, useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import styles from "./CodeBlock.module.css";

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
    <div className={styles.wrapper}>
      {/* 顶栏：语言标签 + 复制按钮 */}
      <div className={styles.header}>
        <span>{language}</span>
        <button
          onClick={handleCopy}
          className={`${styles.copyBtn} ${
            copied ? styles.copyBtnCopied : styles.copyBtnIdle
          }`}
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
          customStyle={{
            margin: 0,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
          }}
        >
          {code.replace(/\n$/, "")}
        </SyntaxHighlighter>
      ) : (
        <pre className={styles.pre}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
});

export default CodeBlock;
