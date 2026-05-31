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

export async function migrateFromLocalStorage(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, count: 0, error: 'Not in browser environment' };
    }

    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) {
      return { success: true, count: 0 };
    }

    const legacySessions: LegacySession[] = JSON.parse(stored);
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'migrateLegacySessions',
        data: { sessions: legacySessions },
      }),
    });

    if (!response.ok) {
      return { success: false, count: 0, error: `HTTP ${response.status}` };
    }

    const result = (await response.json()) as { success: boolean; count: number; error?: string };

    if (result.success) {
      localStorage.setItem(MIGRATION_STATUS_KEY, 'true');
    }

    return result;
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
