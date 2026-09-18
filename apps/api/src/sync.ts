import { eq, and, notInArray, sql } from 'drizzle-orm';
import type { Balance, Source } from '@stripe/link-sdk';
import { accounts, balances, credentials, syncStates, transactions, type Database } from '@sum/db';
import type { SyncState } from '@sum/contracts';
import type { Auth } from './auth.js';
import { normalizeBalance, normalizeSource, normalizeTransaction, paginate } from './finance.js';
import { isPermissionError, safeLinkError } from './link.js';
import { AppError } from './security.js';
import { withLock } from './locks.js';

export function createSync(database: Database, auth: Auth) {
  const { db } = database;
  const running = new Map<string, Promise<void>>();
  let stopping = false;
  function checkRunning() {
    if (stopping)
      throw new AppError(
        503,
        'Sync was interrupted by a restart. Refresh to resume.',
        'sync_interrupted',
      );
  }
  async function state(userId: string): Promise<SyncState> {
    const [row] = await db.select().from(syncStates).where(eq(syncStates.userId, userId));
    const [credential] = await db
      .select({ needsReconnect: credentials.needsReconnect })
      .from(credentials)
      .where(eq(credentials.userId, userId));
    return {
      status: (row?.status ?? 'idle') as SyncState['status'],
      startedAt: row?.startedAt?.toISOString() ?? null,
      completedAt: row?.completedAt?.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      transactionsFetched: row?.transactionsFetched ?? 0,
      message: row?.message ?? null,
      needsReconnect: credential?.needsReconnect ?? true,
      historyComplete: row?.historyComplete ?? false,
    };
  }
  async function run(userId: string, force: boolean) {
    await withLock(
      database,
      `sync:${userId}`,
      async () => {
        checkRunning();
        const previous = await state(userId);
        if (
          !force &&
          previous.status === 'succeeded' &&
          previous.lastSuccessAt &&
          Date.now() - Date.parse(previous.lastSuccessAt) < 15 * 60_000
        )
          return;
        const startedAt = new Date();
        await db
          .insert(syncStates)
          .values({ userId, status: 'running', startedAt, message: null, transactionsFetched: 0 })
          .onConflictDoUpdate({
            target: syncStates.userId,
            set: {
              status: 'running',
              startedAt,
              completedAt: null,
              message: null,
              transactionsFetched: 0,
            },
          });
        const client = auth.client(userId);
        let success = 0;
        let fetched = 0;
        const errors: string[] = [];
        async function attempt(work: () => Promise<void>) {
          try {
            await work();
            success++;
          } catch (error) {
            errors.push(safeLinkError(error));
            if (isPermissionError(error))
              await db
                .update(credentials)
                .set({ needsReconnect: true })
                .where(eq(credentials.userId, userId));
          }
        }
        await attempt(async () => {
          const sourceIds: string[] = [];
          await paginate<Source>(
            (cursor) => {
              checkRunning();
              return client.sources.list({ limit: 100, starting_after: cursor });
            },
            (row) => row.id,
            async (rows) => {
              for (const source of rows) {
                const row = { userId, ...normalizeSource(source, new Date()) };
                sourceIds.push(row.sourceId);
                await db
                  .insert(accounts)
                  .values(row)
                  .onConflictDoUpdate({ target: [accounts.userId, accounts.sourceId], set: row });
              }
            },
          );
          // Only retire sources after a complete list; transient errors never erase previous accounts.
          await db
            .update(accounts)
            .set({ active: false })
            .where(
              and(
                eq(accounts.userId, userId),
                sourceIds.length ? notInArray(accounts.sourceId, sourceIds) : undefined,
              ),
            );
        });
        await attempt(async () => {
          const grouped = new Map<string, ReturnType<typeof normalizeBalance>[]>();
          await paginate<Balance>(
            (cursor) => {
              checkRunning();
              return client.balances.list({ limit: 100, starting_after: cursor });
            },
            (row) => row.source_id,
            async (rows) => {
              for (const balance of rows) {
                const group = grouped.get(balance.source_id) ?? [];
                group.push(normalizeBalance(balance));
                grouped.set(balance.source_id, group);
              }
            },
          );
          await db.transaction(async (tx) => {
            // A complete balance snapshot replaces the old one; missing is unavailable, never zero.
            await tx.delete(balances).where(eq(balances.userId, userId));
            for (const [sourceId, values] of grouped)
              await tx.insert(balances).values({ userId, sourceId, values, fetchedAt: new Date() });
          });
        });
        await attempt(async () => {
          const savePage = async (rows: Parameters<typeof normalizeTransaction>[0][]) => {
            const now = new Date();
            const normalized = [
              ...new Map(
                rows.map((transaction) => {
                  const row = { userId, ...normalizeTransaction(transaction, now) };
                  return [row.externalId, row] as const;
                }),
              ).values(),
            ];
            if (normalized.length)
              await db
                .insert(transactions)
                .values(normalized)
                .onConflictDoUpdate({
                  target: [transactions.userId, transactions.externalId],
                  set: {
                    sourceId: sql`excluded.source_id`,
                    date: sql`excluded.date`,
                    description: sql`excluded.description`,
                    amount: sql`excluded.amount`,
                    currency: sql`excluded.currency`,
                    category: sql`excluded.category`,
                    origin: sql`excluded.origin`,
                    status: sql`excluded.status`,
                    fetchedAt: now,
                  },
                });
            fetched += rows.length;
            await db
              .update(syncStates)
              .set({ transactionsFetched: fetched })
              .where(eq(syncStates.userId, userId));
          };
          // Populate a useful recent view first, without relying on undocumented provider ordering.
          if (!previous.historyComplete) {
            const start = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
            await paginate(
              (cursor) => {
                checkRunning();
                return client.transactions.list({
                  limit: 100,
                  start_date: start,
                  starting_after: cursor,
                });
              },
              (row) => row.id,
              savePage,
            );
            fetched = 0;
          }
          await paginate(
            (cursor) => {
              checkRunning();
              return client.transactions.list({ limit: 100, starting_after: cursor });
            },
            (row) => row.id,
            savePage,
          );
          await db
            .update(syncStates)
            .set({ historyComplete: true })
            .where(eq(syncStates.userId, userId));
        });
        await db
          .update(syncStates)
          .set({
            status: errors.length ? (success ? 'partial' : 'failed') : 'succeeded',
            completedAt: new Date(),
            ...(errors.length ? {} : { lastSuccessAt: new Date() }),
            message: errors.length ? [...new Set(errors)].join(' ') : null,
            transactionsFetched: fetched,
          })
          .where(eq(syncStates.userId, userId));
      },
      false,
    );
  }
  return {
    state,
    start(userId: string, force = false) {
      if (!running.has(userId)) {
        const task = run(userId, force)
          .catch(async () => {
            try {
              await db
                .update(syncStates)
                .set({
                  status: 'failed',
                  completedAt: new Date(),
                  message: 'Sync was interrupted. Refresh to retry.',
                })
                .where(eq(syncStates.userId, userId));
            } catch {
              console.error('Unable to persist sync state; database unavailable.');
            }
          })
          .finally(() => {
            running.delete(userId);
          });
        running.set(userId, task);
      }
      return running.get(userId)!;
    },
    async stop() {
      stopping = true;
      await Promise.allSettled([...running.values()]);
    },
    async settle() {
      await Promise.allSettled([...running.values()]);
    },
  };
}
