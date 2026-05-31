'use client';

import { useState } from 'react';
import styles from './SaveDocumentModal.module.css';

interface EditableDocument {
  id: string;
  title: string;
  category?: string;
  tags?: string[];
  problem?: string;
  solution?: string;
  code?: string;
}

interface SaveDocumentModalProps {
  /** 传入则进入编辑模式，否则为新建模式 */
  document?: EditableDocument;
  /** 新建模式下作为 relatedSessionId，编辑模式可省略 */
  sessionId?: string;
  /** 新建模式下供 AI 提取使用，编辑模式可省略 */
  messages?: Array<{ role: string; content: string }>;
  onClose: () => void;
  onSaved?: () => void;
}

export function SaveDocumentModal({
  document,
  sessionId,
  messages,
  onClose,
  onSaved,
}: SaveDocumentModalProps) {
  const isEdit = !!document;
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    title: document?.title ?? '',
    category: document?.category ?? '',
    tags: document?.tags?.join(', ') ?? '',
    problem: document?.problem ?? '',
    solution: document?.solution ?? '',
    code: document?.code ?? '',
  });

  const handleExtract = async () => {
    setExtracting(true);
    setError('');

    try {
      const res = await fetch('/api/documents/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      const extracted = await res.json();

      if (!res.ok) throw new Error(extracted.error || '提取失败');
      setFormData({
        title: extracted.title || '',
        category: extracted.category || '',
        tags: Array.isArray(extracted.tags) ? extracted.tags.join(', ') : '',
        problem: extracted.problem || '',
        solution: extracted.solution || '',
        code: extracted.code || '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '提取失败');
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      setError('请填写标题');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const tags = formData.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      let body: string;
      if (isEdit) {
        body = JSON.stringify({
          action: 'update',
          data: {
            id: document!.id,
            updates: {
              title: formData.title.trim(),
              category: formData.category.trim() || undefined,
              tags,
              problem: formData.problem.trim() || undefined,
              solution: formData.solution.trim() || undefined,
              code: formData.code.trim() || undefined,
              updatedAt: Date.now(),
            },
          },
        });
      } else {
        const doc = {
          id: `doc-${Date.now()}`,
          title: formData.title.trim(),
          category: formData.category.trim() || undefined,
          tags,
          problem: formData.problem.trim() || undefined,
          solution: formData.solution.trim() || undefined,
          code: formData.code.trim() || undefined,
          relatedSessionId: sessionId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        body = JSON.stringify({ action: 'create', data: doc });
      }

      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!res.ok) throw new Error('保存失败');

      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{isEdit ? '✏️ 编辑文档' : '📝 保存为文档'}</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {!isEdit && (
          <div className={styles.actions}>
            <button
              className={styles.extractBtn}
              onClick={handleExtract}
              disabled={extracting}
            >
              {extracting ? '🤖 AI 提取中...' : '🤖 AI 自动提取'}
            </button>
          </div>
        )}

        <div className={styles.form}>
          <div className={styles.field}>
            <label>标题 *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="简短描述问题"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label>分类</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
                placeholder="React / Next.js / TypeScript..."
              />
            </div>

            <div className={styles.field}>
              <label>标签</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="用逗号分隔，如: hooks, 性能"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label>问题描述</label>
            <textarea
              value={formData.problem}
              onChange={(e) => setFormData({ ...formData, problem: e.target.value })}
              placeholder="详细描述遇到的问题"
              rows={4}
            />
          </div>

          <div className={styles.field}>
            <label>解决方案</label>
            <textarea
              value={formData.solution}
              onChange={(e) =>
                setFormData({ ...formData, solution: e.target.value })
              }
              placeholder="详细描述解决步骤"
              rows={6}
            />
          </div>

          <div className={styles.field}>
            <label>代码示例</label>
            <textarea
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              placeholder="相关代码片段"
              rows={8}
              className={styles.codeArea}
            />
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? '保存中...' : isEdit ? '保存修改' : '保存文档'}
          </button>
        </div>
      </div>
    </div>
  );
}
