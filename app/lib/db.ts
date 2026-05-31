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

// 文档全文检索：external-content FTS5 虚拟表，索引正文五个字段。
// content='documents' 表示内容存于原表，FTS 只存倒排索引，避免数据冗余。
// 注意：external-content 表的 count(*) 会代理回原表，不能用来判断索引是否已建，
// 因此用 sqlite_master 判断本次启动是否首次创建该表，首次创建时 rebuild 回填存量。
const ftsExisted = db
  .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents_fts'`)
  .get();

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title, tags, problem, solution, code,
    content='documents',
    content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, title, tags, problem, solution, code)
    VALUES (new.rowid, new.title, new.tags, new.problem, new.solution, new.code);
  END;

  CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, tags, problem, solution, code)
    VALUES ('delete', old.rowid, old.title, old.tags, old.problem, old.solution, old.code);
  END;

  CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, tags, problem, solution, code)
    VALUES ('delete', old.rowid, old.title, old.tags, old.problem, old.solution, old.code);
    INSERT INTO documents_fts(rowid, title, tags, problem, solution, code)
    VALUES (new.rowid, new.title, new.tags, new.problem, new.solution, new.code);
  END;
`);

// 首次创建 FTS 表时用 'rebuild' 从原表回填存量文档（老库升级场景）。
// 之后由触发器增量维护，无需再 rebuild。
if (!ftsExisted) {
  db.exec(`INSERT INTO documents_fts(documents_fts) VALUES('rebuild');`);
}

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
