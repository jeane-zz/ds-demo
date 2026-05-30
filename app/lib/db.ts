import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

const DB_DIR = path.join(os.homedir(), '.ai-workspace');
const DB_PATH = path.join(DB_DIR, 'data.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    pinned INTEGER DEFAULT 0,
    summary TEXT,
    titleGenerated INTEGER DEFAULT 0,
    compressedUntil INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    variants TEXT,
    activeVariant INTEGER DEFAULT 0,
    FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    tags TEXT,
    problem TEXT,
    solution TEXT,
    code TEXT,
    relatedSessionId TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (relatedSessionId) REFERENCES sessions(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(createdAt);
  CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned, updatedAt DESC);
  CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
  CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(relatedSessionId);
`);

const sessionColumns = db
  .prepare('PRAGMA table_info(sessions)')
  .all() as Array<{ name: string }>;
const sessionColumnNames = new Set(sessionColumns.map((column) => column.name));

if (!sessionColumnNames.has('titleGenerated')) {
  db.exec('ALTER TABLE sessions ADD COLUMN titleGenerated INTEGER DEFAULT 0');
}

if (!sessionColumnNames.has('compressedUntil')) {
  db.exec('ALTER TABLE sessions ADD COLUMN compressedUntil INTEGER DEFAULT 0');
}

export default db;
