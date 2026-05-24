"use client";

import { memo, useState, useCallback, lazy, Suspense } from "react";
import styles from "./CodeBlock.module.css";

interface CodeBlockProps {
  language: string;
  code: string;
  /** 是否启用高亮（streaming 中暂不高亮） */
  highlighted?: boolean;
}

// 把 react-syntax-highlighter + oneDark 主题拆到独立 chunk,
// 只有真的需要高亮(streaming 结束后)时才发起这一次网络请求。
// 首屏 / streaming 中走下面的 <pre> 兜底,体积与首屏交互无关。
const HighlightedPre = lazy(async () => {
  const [{ Prism }, { oneDark }] = await Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism"),
  ]);
  return {
    default: function HighlightedPreImpl({
      language,
      code,
    }: {
      language: string;
      code: string;
    }) {
      return (
        <Prism
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
        </Prism>
      );
    },
  };
});

function PlainPre({ code }: { code: string }) {
  return (
    <pre className={styles.pre}>
      <code>{code}</code>
    </pre>
  );
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

      {highlighted ? (
        <Suspense fallback={<PlainPre code={code} />}>
          <HighlightedPre language={language} code={code} />
        </Suspense>
      ) : (
        <PlainPre code={code} />
      )}
    </div>
  );
});

export default CodeBlock;
