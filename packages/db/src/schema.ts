import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  bigint,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Account } from '@sum/contracts';
const time = (name: string) => timestamp(name, { withTimezone: true });
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: time('created_at').notNull().defaultNow(),
});
export const sessions = pgTable('sessions', {
  hash: text('hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: time('expires_at').notNull(),
});
export const credentials = pgTable('credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  encrypted: text('encrypted').notNull(),
  expiresAt: time('expires_at').notNull(),
  needsReconnect: boolean('needs_reconnect').notNull().default(false),
});
export const authFlows = pgTable('auth_flows', {
  hash: text('hash').primaryKey(),
  deviceCode: text('device_code').notNull(),
  expiresAt: time('expires_at').notNull(),
  nextPollAt: time('next_poll_at').notNull(),
  interval: integer('interval').notNull(),
  expectedUserId: uuid('expected_user_id').references(() => users.id, { onDelete: 'cascade' }),
});
export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    institution: text('institution'),
    last4: text('last4'),
    connectionStatus: text('connection_status'),
    capabilities: jsonb('capabilities').$type<Record<string, string>>().notNull(),
    grantedActions: jsonb('granted_actions').$type<string[]>().notNull(),
    active: boolean('active').notNull().default(true),
    fetchedAt: time('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sourceId] })],
);
export const balances = pgTable(
  'balances',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    values: jsonb('values').$type<Account['balances']>().notNull(),
    fetchedAt: time('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sourceId] })],
);
export const transactions = pgTable(
  'transactions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    sourceId: text('source_id'),
    date: text('date').notNull(),
    description: text('description').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    category: text('category'),
    origin: text('origin').$type<'link' | 'external_connection'>().notNull(),
    status: text('status').notNull(),
    fetchedAt: time('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.externalId] }),
    index('transactions_user_date_idx').on(t.userId, t.date, t.externalId),
    index('transactions_user_source_idx').on(t.userId, t.sourceId),
  ],
);
export const syncStates = pgTable('sync_states', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('idle'),
  startedAt: time('started_at'),
  completedAt: time('completed_at'),
  lastSuccessAt: time('last_success_at'),
  transactionsFetched: integer('transactions_fetched').notNull().default(0),
  message: text('message'),
  historyComplete: boolean('history_complete').notNull().default(false),
});
