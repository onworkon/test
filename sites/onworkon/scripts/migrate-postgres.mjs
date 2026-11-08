import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to initialize the name database.');
const sql = neon(process.env.DATABASE_URL);
const migration = await readFile(new URL('../db/migrations/001_visitor_names.sql', import.meta.url), 'utf8');
await sql.query(migration);
console.log('Visitor name database is ready.');
