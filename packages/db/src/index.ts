import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
export * from './schema.js';
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // Separate lock pools prevent advisory-lock holders from exhausting data connections.
  const syncLocks = new pg.Pool({ connectionString, max: 3 });
  const loginLocks = new pg.Pool({ connectionString, max: 3 });
  const tokenLocks = new pg.Pool({ connectionString, max: 3 });
  return {
    db: drizzle(pool),
    pool,
    syncLocks,
    loginLocks,
    tokenLocks,
    async close() {
      await Promise.all([pool.end(), syncLocks.end(), loginLocks.end(), tokenLocks.end()]);
    },
  };
}
export type Database = ReturnType<typeof createDatabase>;
