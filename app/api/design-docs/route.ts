import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface DesignDoc {
  id: string;
  title: string;
  category: string;
  tags: string[];
  filename: string;
  order: number;
}

const DESIGN_DOCS: DesignDoc[] = [
  {
    id: '01',
    title: 'LLM Provider 架构',
    category: '设计方案',
    tags: ['Provider', 'Fallback', 'Ollama', 'DeepSeek'],
    filename: '01-llm-provider-architecture.md',
    order: 1,
  },
  {
    id: '02',
    title: '双层 RAG 策略',
    category: '设计方案',
    tags: ['RAG', 'MiniLM', '嵌入', '全文检索'],
    filename: '02-dual-rag-strategy.md',
    order: 2,
  },
  {
    id: '03',
    title: '本地工具调用系统',
    category: '设计方案',
    tags: ['Function Calling', '工具', '注册'],
    filename: '03-tool-calling-system.md',
    order: 3,
  },
  {
    id: '04',
    title: 'SQLite 存储与数据迁移',
    category: '设计方案',
    tags: ['SQLite', 'FTS5', '迁移', '持久化'],
    filename: '04-sqlite-storage-and-migration.md',
    order: 4,
  },
  {
    id: '05',
    title: '前端状态管理与性能优化',
    category: '设计方案',
    tags: ['TaskQueue', 'memo', '虚拟化', '性能'],
    filename: '05-state-management-and-performance.md',
    order: 5,
  },
  {
    id: '06',
    title: '知识文档系统',
    category: '设计方案',
    tags: ['文档', 'AI提取', '分类'],
    filename: '06-knowledge-document-system.md',
    order: 6,
  },
];

const DOCS_DIR = path.join(process.cwd(), 'app/docs');

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const doc = DESIGN_DOCS.find((d) => d.id === id);
      if (!doc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const filePath = path.join(DOCS_DIR, doc.filename);
      const content = fs.readFileSync(filePath, 'utf-8');

      return NextResponse.json({ ...doc, content });
    }

    // 返回列表
    return NextResponse.json(DESIGN_DOCS);
  } catch (error) {
    console.error('Failed to read design doc:', error);
    return NextResponse.json(
      { error: 'Failed to read design document' },
      { status: 500 }
    );
  }
}
