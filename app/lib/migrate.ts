import { SessionDAO, MessageDAO } from './dao';

const LEGACY_STORAGE_KEY = 'chat_sessions';
const MIGRATION_STATUS_KEY = 'chat_sessions_migrated_to_sqlite';

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

export function migrateFromLocalStorage(): { success: boolean; count: number; error?: string } {
  try {
    if (typeof window === 'undefined') {
      return { success: false, count: 0, error: 'Not in browser environment' };
    }

    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) {
      return { success: true, count: 0 };
    }

    const legacySessions: LegacySession[] = JSON.parse(stored);
    let migratedCount = 0;

    for (const legacy of legacySessions) {
      const createdAt = legacy.createdAt ?? legacy.updatedAt;
      const existingSession = SessionDAO.getById(legacy.id);
      if (existingSession) {
        continue;
      }

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
      migratedCount++;
    }

    if (migratedCount > 0) {
      localStorage.setItem(MIGRATION_STATUS_KEY, 'true');
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
  return localStorage.getItem(MIGRATION_STATUS_KEY) === 'true';
}
