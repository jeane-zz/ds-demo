import { NextRequest, NextResponse } from 'next/server';
import { SessionDAO, MessageDAO } from '@/app/lib/dao';

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
