import { and, eq, desc, asc, ilike, or, gte, lte, lt, isNull, sql } from 'drizzle-orm';
import { accounts, balances, transactions, type Database } from '@sum/db';
import type {
  Account,
  TransactionQuery,
  Transaction,
  TransactionsPage,
  Filters,
} from '@sum/contracts';
import { decodeCursor, encodeCursor } from './finance.js';

export function createCatalog({ db }: Database) {
  return {
    async accounts(userId: string): Promise<Account[]> {
      const rows = await db
        .select({ account: accounts, balance: balances })
        .from(accounts)
        .leftJoin(
          balances,
          and(eq(balances.userId, accounts.userId), eq(balances.sourceId, accounts.sourceId)),
        )
        .where(eq(accounts.userId, userId))
        .orderBy(desc(accounts.active), asc(accounts.name));
      return rows.map(({ account: a, balance: b }) => ({
        id: a.sourceId,
        name: a.name,
        type: a.type,
        institution: a.institution,
        last4: a.last4,
        connectionStatus: a.connectionStatus,
        capabilities: a.capabilities,
        grantedActions: a.grantedActions,
        active: a.active,
        fetchedAt: a.fetchedAt.toISOString(),
        balances: b?.values ?? [],
      }));
    },
    async transactions(userId: string, query: TransactionQuery): Promise<TransactionsPage> {
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const escaped = query.q.replace(/[\\%_]/g, '\\$&');
      const rows = await db
        .select({ transaction: transactions, accountName: accounts.name })
        .from(transactions)
        .leftJoin(
          accounts,
          and(
            eq(accounts.userId, transactions.userId),
            eq(accounts.sourceId, transactions.sourceId),
          ),
        )
        .where(
          and(
            eq(transactions.userId, userId),
            query.q ? ilike(transactions.description, `%${escaped}%`) : undefined,
            query.account === 'unassigned'
              ? isNull(transactions.sourceId)
              : query.account
                ? eq(transactions.sourceId, query.account)
                : undefined,
            query.category === 'uncategorized'
              ? or(isNull(transactions.category), eq(transactions.category, 'uncategorized'))
              : query.category
                ? eq(transactions.category, query.category)
                : undefined,
            query.origin ? eq(transactions.origin, query.origin) : undefined,
            query.start ? gte(transactions.date, query.start) : undefined,
            query.end ? lte(transactions.date, query.end) : undefined,
            cursor
              ? or(
                  lt(transactions.date, cursor[0]),
                  and(eq(transactions.date, cursor[0]), lt(transactions.externalId, cursor[1])),
                )
              : undefined,
          ),
        )
        .orderBy(desc(transactions.date), desc(transactions.externalId))
        .limit(query.limit + 1);
      const data: Transaction[] = rows
        .slice(0, query.limit)
        .map(({ transaction: t, accountName }) => ({
          id: t.externalId,
          accountId: t.sourceId,
          accountName,
          date: t.date,
          description: t.description,
          amount: t.amount,
          currency: t.currency,
          category: t.category,
          origin: t.origin,
          status: t.status,
        }));
      return {
        data,
        nextCursor:
          rows.length > query.limit && data.length ? encodeCursor(data[data.length - 1]!) : null,
      };
    },
    async filters(userId: string): Promise<Filters> {
      const [sources, categories] = await Promise.all([
        db
          .select({ id: accounts.sourceId, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.userId, userId))
          .orderBy(asc(accounts.name)),
        db
          .selectDistinct({ category: transactions.category })
          .from(transactions)
          .where(eq(transactions.userId, userId))
          .orderBy(asc(transactions.category)),
      ]);
      return {
        accounts: sources,
        categories: categories.flatMap((row) =>
          row.category && row.category !== 'uncategorized' ? [row.category] : [],
        ),
      };
    },
  };
}
