import { NextRequest, NextResponse } from 'next/server';
import { SessionDAO, MessageDAO } from '@/app/lib/dao';

interface LegacySession {
  id: string;
  title: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    variants?: string[];
    activeVariant?: number;
  }>;
  createdAt?: number;
  updatedAt: number;
  pinned?: boolean;
  summary?: string;
  titleGenerated?: boolean;
  compressedUntil?: number;
}

export async function GET() {
  try {
    const sessions = SessionDAO.getAll();
    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Failed to fetch sessions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, data } = body;

    switch (action) {
      case 'create':
        SessionDAO.create(data);
        return NextResponse.json({ success: true });

      case 'update':
        SessionDAO.update(data.id, data.updates);
        return NextResponse.json({ success: true });

      case 'delete':
        SessionDAO.delete(data.id);
        return NextResponse.json({ success: true });

      case 'getMessages':
        const messages = MessageDAO.getBySessionId(data.sessionId);
        return NextResponse.json(messages);

      case 'createMessage':
        MessageDAO.create(data);
        return NextResponse.json({ success: true });

      case 'updateMessage':
        MessageDAO.update(data.id, data.updates);
        return NextResponse.json({ success: true });

      case 'bulkCreateMessages':
        MessageDAO.bulkCreate(data.messages);
        return NextResponse.json({ success: true });

      case 'bulkReplaceMessages':
        MessageDAO.deleteBySessionId(data.sessionId);
        MessageDAO.bulkCreate(data.messages);
        return NextResponse.json({ success: true });

      case 'migrateLegacySessions': {
        const legacySessions = (data.sessions ?? []) as LegacySession[];
        let count = 0;

        for (const legacy of legacySessions) {
          if (SessionDAO.getById(legacy.id)) {
            continue;
          }

          const createdAt = legacy.createdAt ?? legacy.updatedAt;

          SessionDAO.create({
            id: legacy.id,
            title: legacy.title,
            createdAt,
            updatedAt: legacy.updatedAt,
            pinned: legacy.pinned || false,
            summary: legacy.summary,
            titleGenerated: legacy.titleGenerated,
            compressedUntil: legacy.compressedUntil,
          });

          const messages = legacy.messages.map((msg, index) => ({
            id: `${legacy.id}-${index}`,
            sessionId: legacy.id,
            role: msg.role,
            content: msg.content,
            createdAt: createdAt + index,
            variants: msg.variants,
            activeVariant: msg.activeVariant,
          }));

          MessageDAO.bulkCreate(messages);
          count++;
        }

        return NextResponse.json({ success: true, count });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Session API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
