import { neon } from '@neondatabase/serverless';
import { normalizeName, validName } from '../dist/name-validation.js';

export function openPostgresNamesStore(connectionString) {
  const sql = neon(connectionString);
  return {
    async saveName(value, submissionId) {
      if (!validName(value) || typeof submissionId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(submissionId)) {
        const error = new Error('Invalid name or submission ID.');
        error.status = 400;
        throw error;
      }
      const name = normalizeName(value);
      const inserted = await sql`
        INSERT INTO visitor_names (id, name) VALUES (${submissionId}, ${name})
        ON CONFLICT (id) DO NOTHING
        RETURNING id, name, created_at
      `;
      const rows = inserted.length ? inserted : await sql`
        SELECT id, name, created_at FROM visitor_names WHERE id = ${submissionId}
      `;
      const row = rows[0];
      if (!row) throw new Error('Name storage could not be confirmed.');
      if (row.name !== name) {
        const error = new Error('Submission ID is already in use.');
        error.status = 409;
        throw error;
      }
      return { saved: true, created: inserted.length > 0, id: row.id, createdAt: new Date(row.created_at).toISOString() };
    },
  };
}
