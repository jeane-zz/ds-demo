'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { SaveDocumentModal } from '../components/SaveDocumentModal';
import styles from './docs.module.css';

interface Document {
  id: string;
  title: string;
  category?: string;
  tags?: string[];
  problem?: string;
  solution?: string;
  code?: string;
  relatedSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export default function DocsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) throw new Error('Failed to load documents');
      const data = await res.json();
      setDocuments(data);
      return data as Document[];
    } catch (error) {
      console.error('Failed to load documents:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadDocuments();
      setLoading(false);
    })();
  }, [loadDocuments]);

  const deleteDocument = async (id: string) => {
    if (!confirm('确定要删除这个文档吗？')) return;

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', data: { id } }),
      });

      if (!res.ok) throw new Error('Failed to delete');

      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (selectedDoc?.id === id) {
        setSelectedDoc(null);
      }
    } catch (error) {
      console.error('Failed to delete document:', error);
      alert('删除失败');
    }
  };

  const handleEdited = async () => {
    const editedId = editingDoc?.id;
    const data = await loadDocuments();
    if (data && editedId) {
      const updated = data.find((d) => d.id === editedId);
      if (updated) setSelectedDoc(updated);
    }
  };

  const filteredDocs = documents.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.tags?.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const categories = [...new Set(documents.map((d) => d.category).filter(Boolean))];

  const groupedDocs = categories.reduce((acc, cat) => {
    acc[cat!] = filteredDocs.filter((d) => d.category === cat);
    return acc;
  }, {} as Record<string, Document[]>);

  const uncategorized = filteredDocs.filter((d) => !d.category);
  if (uncategorized.length > 0) {
    groupedDocs['未分类'] = uncategorized;
  }

  return (
    <div className={styles.container}>
      {/* 顶部导航 */}
      <header className={styles.header}>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navItem}>
            💬 对话
          </Link>
          <Link href="/docs" className={styles.navItem + ' ' + styles.navItemActive}>
            📚 文档
          </Link>
        </nav>
      </header>

      <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <input
          className={styles.searchInput}
          placeholder="搜索文档..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        {loading ? (
          <div className={styles.loading}>加载中...</div>
        ) : documents.length === 0 ? (
          <div className={styles.empty}>
            <p>还没有文档</p>
            <p className={styles.hint}>在对话中点击&quot;保存为文档&quot;来创建</p>
          </div>
        ) : (
          <div className={styles.categories}>
            {Object.entries(groupedDocs).map(([cat, docs]) => (
              <div key={cat} className={styles.category}>
                <h3>
                  📁 {cat} <span className={styles.count}>({docs.length})</span>
                </h3>
                <ul>
                  {docs.map((doc) => (
                    <li
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                      className={selectedDoc?.id === doc.id ? styles.active : ''}
                    >
                      <div className={styles.docTitle}>{doc.title}</div>
                      {doc.tags && doc.tags.length > 0 && (
                        <div className={styles.docTags}>
                          {doc.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className={styles.tag}>
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </aside>

      <main className={styles.main}>
        {selectedDoc ? (
          <article className={styles.document}>
            <div className={styles.docHeader}>
              <h1>{selectedDoc.title}</h1>
              <div className={styles.docActions}>
                <button
                  className={styles.editBtn}
                  onClick={() => setEditingDoc(selectedDoc)}
                >
                  ✏️ 编辑
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => deleteDocument(selectedDoc.id)}
                >
                  🗑️ 删除
                </button>
              </div>
            </div>

            <div className={styles.meta}>
              {selectedDoc.category && (
                <span className={styles.categoryBadge}>{selectedDoc.category}</span>
              )}
              {selectedDoc.tags?.map((tag) => (
                <span key={tag} className={styles.tagBadge}>
                  #{tag}
                </span>
              ))}
              <span className={styles.date}>
                {new Date(selectedDoc.createdAt).toLocaleDateString('zh-CN')}
              </span>
            </div>

            {selectedDoc.problem && (
              <section className={styles.section}>
                <h2>🔍 问题描述</h2>
                <div className={styles.content}>
                  <ReactMarkdown>{selectedDoc.problem}</ReactMarkdown>
                </div>
              </section>
            )}

            {selectedDoc.solution && (
              <section className={styles.section}>
                <h2>✅ 解决方案</h2>
                <div className={styles.content}>
                  <ReactMarkdown>{selectedDoc.solution}</ReactMarkdown>
                </div>
              </section>
            )}

            {selectedDoc.code && (
              <section className={styles.section}>
                <h2>💻 代码示例</h2>
                <SyntaxHighlighter
                  language="typescript"
                  style={oneDark}
                  customStyle={{ borderRadius: '8px', fontSize: '14px' }}
                >
                  {selectedDoc.code}
                </SyntaxHighlighter>
              </section>
            )}

            {selectedDoc.relatedSessionId && (
              <div className={styles.relatedSession}>
                <a href={`/?session=${selectedDoc.relatedSessionId}`}>
                  🔗 查看原始对话
                </a>
              </div>
            )}
          </article>
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.placeholderIcon}>📄</div>
            <p>选择一个文档查看</p>
          </div>
        )}
      </main>
      </div>

      {editingDoc && (
        <SaveDocumentModal
          document={editingDoc}
          onClose={() => setEditingDoc(null)}
          onSaved={handleEdited}
        />
      )}
    </div>
  );
}
