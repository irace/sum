import type { Database } from '@sum/db';
// PostgreSQL session locks protect work across processes, without holding a DB transaction during network calls.
export async function withLock<T>(
  database: Database,
  name: string,
  work: () => Promise<T>,
  wait = true,
): Promise<T | undefined> {
  const client = await (
    name.startsWith('sync:')
      ? database.syncLocks
      : name.startsWith('login:')
        ? database.loginLocks
        : database.tokenLocks
  ).connect();
  let acquired = false;
  try {
    const result = await client.query(
      wait
        ? 'SELECT pg_advisory_lock(hashtextextended($1, 0))'
        : 'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [name],
    );
    acquired = wait || result.rows[0]?.acquired === true;
    if (!acquired) return undefined;
    return await work();
  } finally {
    try {
      if (acquired)
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [name]);
    } finally {
      client.release();
    }
  }
}
