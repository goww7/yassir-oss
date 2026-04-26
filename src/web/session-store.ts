import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const DB_DIR = '.agents';
const DB_FILE = join(DB_DIR, 'web-sessions.db');

let db: Database | null = null;

function getDb(): Database {
  if (db) return db;
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_FILE, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      events TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)');
  return db;
}

export interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  events: string;
  timestamp: number;
}

export function ensureSession(sessionId: string): void {
  const d = getDb();
  d.run('INSERT OR IGNORE INTO sessions (id) VALUES (?)', [sessionId]);
  d.run("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?", [sessionId]);
}

export function saveMessage(sessionId: string, role: 'user' | 'assistant', content: string, events: unknown[] = [], timestamp: number = Date.now()): void {
  ensureSession(sessionId);
  getDb().run(
    'INSERT INTO messages (session_id, role, content, events, timestamp) VALUES (?, ?, ?, ?, ?)',
    [sessionId, role, content, JSON.stringify(events), timestamp],
  );
}

export function getMessages(sessionId: string): StoredMessage[] {
  return getDb().query(
    'SELECT role, content, events, timestamp FROM messages WHERE session_id = ? ORDER BY id ASC'
  ).all(sessionId) as StoredMessage[];
}

export function listSessions(): Array<{ id: string; createdAt: string; updatedAt: string; messageCount: number }> {
  return getDb().query(`
    SELECT s.id, s.created_at as createdAt, s.updated_at as updatedAt, COUNT(m.id) as messageCount
    FROM sessions s LEFT JOIN messages m ON s.id = m.session_id
    GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 50
  `).all() as Array<{ id: string; createdAt: string; updatedAt: string; messageCount: number }>;
}

export function deleteSession(sessionId: string): void {
  const d = getDb();
  d.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
  d.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
}
