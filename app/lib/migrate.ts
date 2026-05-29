import { SessionDAO, MessageDAO } from './dao';

interface LegacySession {
  id: string;
  title: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    variants?: string[];
    activeVariant?: number;
  }>;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  summary?: string;
}

export function migrateFromLocalStorage(): { success: boolean; count: number; error?: string } {
  try {
    if (typeof window === 'undefined') {
      return { success: false, count: 0, error: 'Not in browser environment' };
    }

    const stored = localStorage.getItem('ai-sessions');
    if (!stored) {
      return { success: true, count: 0 };
    }

    const legacySessions: LegacySession[] = JSON.parse(stored);
    let migratedCount = 0;

    for (const legacy of legacySessions) {
      const existingSession = SessionDAO.getById(legacy.id);
      if (existingSession) {
        continue;
      }

      SessionDAO.create({
        id: legacy.id,
        title: legacy.title,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        pinned: legacy.pinned || false,
        summary: legacy.summary,
      });

      const messages = legacy.messages.map((msg, index) => ({
        id: `${legacy.id}-${index}`,
        sessionId: legacy.id,
        role: msg.role,
        content: msg.content,
        createdAt: legacy.createdAt + index,
        variants: msg.variants,
        activeVariant: msg.activeVariant,
      }));

      MessageDAO.bulkCreate(messages);
      migratedCount++;
    }

    if (migratedCount > 0) {
      localStorage.setItem('ai-sessions-migrated', 'true');
    }

    return { success: true, count: migratedCount };
  } catch (error) {
    console.error('Migration failed:', error);
    return {
      success: false,
      count: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function checkMigrationStatus(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('ai-sessions-migrated') === 'true';
}
