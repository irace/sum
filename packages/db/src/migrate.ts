import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './index.js';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const database = createDatabase(process.env.DATABASE_URL);
const { db } = database;
const lock = await database.pool.connect();
try {
  await lock.query("SELECT pg_advisory_lock(hashtextextended('sum:migrations', 0))");
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle/', import.meta.url)) });
} finally {
  try {
    await lock.query("SELECT pg_advisory_unlock(hashtextextended('sum:migrations', 0))");
  } finally {
    lock.release();
    await database.close();
  }
}
