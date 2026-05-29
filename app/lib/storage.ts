export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  summary?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  variants?: string[];
  activeVariant?: number;
}

class StorageAdapter {
  async getAllSessions(): Promise<Session[]> {
    const response = await fetch('/api/sessions');
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return response.json();
  }

  async createSession(session: Session): Promise<void> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', data: session }),
    });
    if (!response.ok) throw new Error('Failed to create session');
  }

  async updateSession(id: string, updates: Partial<Session>): Promise<void> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', data: { id, updates } }),
    });
    if (!response.ok) throw new Error('Failed to update session');
  }

  async deleteSession(id: string): Promise<void> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', data: { id } }),
    });
    if (!response.ok) throw new Error('Failed to delete session');
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getMessages', data: { sessionId } }),
    });
    if (!response.ok) throw new Error('Failed to fetch messages');
    return response.json();
  }

  async createMessage(message: Message): Promise<void> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createMessage', data: message }),
    });
    if (!response.ok) throw new Error('Failed to create message');
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<void> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateMessage', data: { id, updates } }),
    });
    if (!response.ok) throw new Error('Failed to update message');
  }

  async bulkCreateMessages(messages: Message[]): Promise<void> {
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'bulkCreateMessages', data: { messages } }),
    });
    if (!response.ok) throw new Error('Failed to bulk create messages');
  }
}

export const storage = new StorageAdapter();
