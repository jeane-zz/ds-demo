'use client';

import { useState } from 'react';
import styles from './SaveDocumentModal.module.css';

interface SaveDocumentModalProps {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  onClose: () => void;
  onSaved?: () => void;
}

export function SaveDocumentModal({
  sessionId,
  messages,
  onClose,
  onSaved,
}: SaveDocumentModalProps) {
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    category: '',
    tags: '',
    problem: '',
    solution: '',
    code: '',
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

      if (!res.ok) throw new Error('提取失败');

      const extracted = await res.json();
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
      const doc = {
        id: `doc-${Date.now()}`,
        title: formData.title.trim(),
        category: formData.category.trim() || undefined,
        tags: formData.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        problem: formData.problem.trim() || undefined,
        solution: formData.solution.trim() || undefined,
        code: formData.code.trim() || undefined,
        relatedSessionId: sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', data: doc }),
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
          <h2>📝 保存为文档</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button
            className={styles.extractBtn}
            onClick={handleExtract}
            disabled={extracting}
          >
            {extracting ? '🤖 AI 提取中...' : '🤖 AI 自动提取'}
          </button>
        </div>

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
            {loading ? '保存中...' : '保存文档'}
          </button>
        </div>
      </div>
    </div>
  );
}
