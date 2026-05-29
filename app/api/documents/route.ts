import { NextRequest, NextResponse } from 'next/server';
import { DocumentDAO } from '@/app/lib/dao';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const doc = DocumentDAO.getById(id);
      if (!doc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      return NextResponse.json(doc);
    }

    const documents = DocumentDAO.getAll();
    return NextResponse.json(documents);
  } catch (error) {
    console.error('Failed to fetch documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, data } = body;

    switch (action) {
      case 'create': {
        // 如果 relatedSessionId 对应的 session 在 DB 中不存在，
        // 外键约束会导致插入失败，此时置为 null
        const { SessionDAO } = await import('@/app/lib/dao');
        if (data.relatedSessionId && !SessionDAO.getById(data.relatedSessionId)) {
          data.relatedSessionId = undefined;
        }
        DocumentDAO.create(data);
        return NextResponse.json({ success: true, id: data.id });
      }

      case 'update':
        DocumentDAO.update(data.id, data.updates);
        return NextResponse.json({ success: true });

      case 'delete':
        DocumentDAO.delete(data.id);
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Document API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
