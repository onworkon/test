import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeName, validName } from '../dist/name-validation.js';

export function openNamesStore(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec("CREATE TABLE IF NOT EXISTS visitor_names (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 32), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))");
  const insert = db.prepare('INSERT INTO visitor_names (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING');
  const find = db.prepare('SELECT id, name, created_at FROM visitor_names WHERE id = ?');

  return {
    saveName(value, submissionId) {
      if (!validName(value) || typeof submissionId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(submissionId)) {
        const error = new Error('Invalid name or submission ID.');
        error.status = 400;
        throw error;
      }
      const name = normalizeName(value);
      const result = insert.run(submissionId, name);
      const row = find.get(submissionId);
      if (row.name !== name) {
        const error = new Error('Submission ID is already in use.');
        error.status = 409;
        throw error;
      }
      return { saved: true, created: result.changes > 0, id: row.id, createdAt: row.created_at };
    },
    close() { db.close(); },
  };
}