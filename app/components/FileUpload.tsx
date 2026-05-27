"use client";

import { useState, useRef, useCallback } from "react";
import styles from "./FileUpload.module.css";

export interface FileItem {
  name: string;
  size: number;
  type: string;
  content: string;
  addedAt: number;
}

interface FileUploadProps {
  /** 已选择的文件列表 */
  files: FileItem[];
  /** 新增文件 */
  onAdd: (items: FileItem[]) => void;
  /** 移除指定文件 */
  onRemove: (name: string) => void;
  /** 清空全部 */
  onClear: () => void;
}

/** 可接受的文件类型 */
const ACCEPT_TYPES = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs",
  ".json", ".md", ".mdx",
  ".css", ".scss", ".less",
  ".html", ".htm",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".yaml", ".yml", ".toml",
  ".sh", ".bash", ".zsh",
  ".txt", ".log",
  ".sql", ".graphql",
  ".xml",
];

const MAX_FILE_SIZE = 512 * 1024; // 512KB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileUpload({
  files,
  onAdd,
  onRemove,
  onClear,
}: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFiles = useCallback(
    async (fileList: FileList) => {
      setError(null);
      const items: FileItem[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];

        if (file.size > MAX_FILE_SIZE) {
          setError(`${file.name} 超过 512KB 限制，已跳过`);
          continue;
        }

        try {
          const content = await file.text();
          items.push({
            name: file.name,
            size: file.size,
            type: file.type,
            content,
            addedAt: Date.now(),
          });
        } catch {
          setError(`${file.name} 读取失败，已跳过`);
        }
      }

      if (items.length > 0) {
        onAdd(items);
      }
    },
    [onAdd],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      readFiles(e.target.files);
    }
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      readFiles(e.dataTransfer.files);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div
        className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT_TYPES.join(",")}
          onChange={handleChange}
        />
        <span className={styles.dropHint}>
          {dragOver ? "释放以上传" : "点击或拖拽文件到此处"}
        </span>
        <span className={styles.dropSub}>支持代码、文档、配置等文本文件（单文件 ≤ 512KB）</span>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {files.length > 0 && (
        <div className={styles.fileList}>
          <div className={styles.fileListHeader}>
            <span className={styles.fileCount}>{files.length} 个文件</span>
            <button className={styles.clearBtn} onClick={onClear}>
              清空全部
            </button>
          </div>
          {files.map((file) => (
            <div key={file.name} className={styles.fileItem}>
              <div className={styles.fileInfo}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>{formatSize(file.size)}</span>
              </div>
              <button
                className={styles.removeBtn}
                onClick={() => onRemove(file.name)}
                title="移除此文件"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
