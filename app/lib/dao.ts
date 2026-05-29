import db from './db';

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

export interface Document {
  id: string;
  title: string;
  category?: string;
  tags?: string[];
  problem?: string;
  solution?: string;
  code?: string;
  relatedSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export class SessionDAO {
  static getAll(): Session[] {
    const rows = db.prepare(`
      SELECT id, title, createdAt, updatedAt, pinned, summary
      FROM sessions
      ORDER BY pinned DESC, updatedAt DESC
    `).all() as Array<{
      id: string;
      title: string;
      createdAt: number;
      updatedAt: number;
      pinned: number;
      summary: string | null;
    }>;

    return rows.map(row => ({
      ...row,
      pinned: row.pinned === 1,
      summary: row.summary || undefined,
    }));
  }

  static getById(id: string): Session | null {
    const row = db.prepare(`
      SELECT id, title, createdAt, updatedAt, pinned, summary
      FROM sessions
      WHERE id = ?
    `).get(id) as {
      id: string;
      title: string;
      createdAt: number;
      updatedAt: number;
      pinned: number;
      summary: string | null;
    } | undefined;

    if (!row) return null;

    return {
      ...row,
      pinned: row.pinned === 1,
      summary: row.summary || undefined,
    };
  }

  static create(session: Session): void {
    db.prepare(`
      INSERT INTO sessions (id, title, createdAt, updatedAt, pinned, summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.title,
      session.createdAt,
      session.updatedAt,
      session.pinned ? 1 : 0,
      session.summary || null
    );
  }

  static update(id: string, updates: Partial<Session>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.updatedAt !== undefined) {
      fields.push('updatedAt = ?');
      values.push(updates.updatedAt);
    }
    if (updates.pinned !== undefined) {
      fields.push('pinned = ?');
      values.push(updates.pinned ? 1 : 0);
    }
    if (updates.summary !== undefined) {
      fields.push('summary = ?');
      values.push(updates.summary || null);
    }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id: string): void {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }
}

export class MessageDAO {
  static getBySessionId(sessionId: string): Message[] {
    const rows = db.prepare(`
      SELECT id, sessionId, role, content, createdAt, variants, activeVariant
      FROM messages
      WHERE sessionId = ?
      ORDER BY createdAt ASC
    `).all(sessionId) as Array<{
      id: string;
      sessionId: string;
      role: string;
      content: string;
      createdAt: number;
      variants: string | null;
      activeVariant: number;
    }>;

    return rows.map(row => ({
      ...row,
      role: row.role as 'user' | 'assistant' | 'system',
      variants: row.variants ? JSON.parse(row.variants) : undefined,
      activeVariant: row.activeVariant || undefined,
    }));
  }

  static create(message: Message): void {
    db.prepare(`
      INSERT INTO messages (id, sessionId, role, content, createdAt, variants, activeVariant)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.sessionId,
      message.role,
      message.content,
      message.createdAt,
      message.variants ? JSON.stringify(message.variants) : null,
      message.activeVariant || 0
    );
  }

  static update(id: string, updates: Partial<Message>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.variants !== undefined) {
      fields.push('variants = ?');
      values.push(JSON.stringify(updates.variants));
    }
    if (updates.activeVariant !== undefined) {
      fields.push('activeVariant = ?');
      values.push(updates.activeVariant);
    }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static deleteBySessionId(sessionId: string): void {
    db.prepare('DELETE FROM messages WHERE sessionId = ?').run(sessionId);
  }

  static bulkCreate(messages: Message[]): void {
    const insert = db.prepare(`
      INSERT INTO messages (id, sessionId, role, content, createdAt, variants, activeVariant)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((msgs: Message[]) => {
      for (const msg of msgs) {
        insert.run(
          msg.id,
          msg.sessionId,
          msg.role,
          msg.content,
          msg.createdAt,
          msg.variants ? JSON.stringify(msg.variants) : null,
          msg.activeVariant || 0
        );
      }
    });

    transaction(messages);
  }
}

export class DocumentDAO {
  static getAll(): Document[] {
    const rows = db.prepare(`
      SELECT id, title, category, tags, problem, solution, code, relatedSessionId, createdAt, updatedAt
      FROM documents
      ORDER BY updatedAt DESC
    `).all() as Array<{
      id: string;
      title: string;
      category: string | null;
      tags: string | null;
      problem: string | null;
      solution: string | null;
      code: string | null;
      relatedSessionId: string | null;
      createdAt: number;
      updatedAt: number;
    }>;

    return rows.map(row => ({
      ...row,
      category: row.category || undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      problem: row.problem || undefined,
      solution: row.solution || undefined,
      code: row.code || undefined,
      relatedSessionId: row.relatedSessionId || undefined,
    }));
  }

  static getById(id: string): Document | null {
    const row = db.prepare(`
      SELECT id, title, category, tags, problem, solution, code, relatedSessionId, createdAt, updatedAt
      FROM documents
      WHERE id = ?
    `).get(id) as {
      id: string;
      title: string;
      category: string | null;
      tags: string | null;
      problem: string | null;
      solution: string | null;
      code: string | null;
      relatedSessionId: string | null;
      createdAt: number;
      updatedAt: number;
    } | undefined;

    if (!row) return null;

    return {
      ...row,
      category: row.category || undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      problem: row.problem || undefined,
      solution: row.solution || undefined,
      code: row.code || undefined,
      relatedSessionId: row.relatedSessionId || undefined,
    };
  }

  static create(doc: Document): void {
    db.prepare(`
      INSERT INTO documents (id, title, category, tags, problem, solution, code, relatedSessionId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      doc.id,
      doc.title,
      doc.category || null,
      doc.tags ? JSON.stringify(doc.tags) : null,
      doc.problem || null,
      doc.solution || null,
      doc.code || null,
      doc.relatedSessionId || null,
      doc.createdAt,
      doc.updatedAt
    );
  }

  static update(id: string, updates: Partial<Document>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category || null);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }
    if (updates.problem !== undefined) {
      fields.push('problem = ?');
      values.push(updates.problem || null);
    }
    if (updates.solution !== undefined) {
      fields.push('solution = ?');
      values.push(updates.solution || null);
    }
    if (updates.code !== undefined) {
      fields.push('code = ?');
      values.push(updates.code || null);
    }
    if (updates.updatedAt !== undefined) {
      fields.push('updatedAt = ?');
      values.push(updates.updatedAt);
    }

    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  static delete(id: string): void {
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }
}
