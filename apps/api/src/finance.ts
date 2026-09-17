import type { Source, Balance, Transaction as LinkTransaction } from '@stripe/link-sdk';
import type { Account, Money, Transaction } from '@sum/contracts';
import { z } from 'zod';
import { AppError } from './security.js';

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export function minorAmount(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new AppError(
      502,
      'Link returned an unsupported monetary amount. Saved data has been preserved.',
      'invalid_link_data',
    );
  return value;
}
export function normalizeSource(source: Source, now: Date) {
  if (!source.id)
    throw new AppError(
      502,
      'Link returned an account without an identifier. Some data could not be synced.',
      'invalid_link_data',
    );
  const bank = record(source.bank_account);
  const card = record(source.card);
  const last4 = text(bank.last4) ?? text(card.last4);
  const capabilities = Object.fromEntries(
    Object.entries(source.capabilities ?? {}).flatMap(([key, value]) => {
      const status = text(record(value).status);
      return status ? [[key, status]] : [];
    }),
  );
  return {
    sourceId: source.id,
    name: text(source.name) ?? text(bank.bank_name) ?? 'Connected account',
    type: text(source.type) ?? 'unknown',
    institution: text(bank.bank_name) ?? text(record(source.external_connection).institution_name),
    last4: last4 && /^\d{4}$/.test(last4) ? last4 : null,
    connectionStatus: text(record(source.external_connection).status),
    capabilities,
    grantedActions: source.granted_actions ?? [],
    active: true,
    fetchedAt: now,
  };
}
export function normalizeBalance(balance: Balance): Account['balances'][number] {
  const amounts = (values: Record<string, number> | undefined): Money[] =>
    Object.entries(values ?? {}).map(([currency, value]) => ({
      currency: currency.toUpperCase(),
      amount: minorAmount(value),
    }));
  return {
    type: balance.type,
    current: { amount: minorAmount(balance.current), currency: balance.currency.toUpperCase() },
    available: amounts(balance.cash?.available),
    used: amounts(balance.credit?.used),
    asOf: balance.as_of,
  };
}
export function normalizeTransaction(transaction: LinkTransaction, now: Date) {
  if (!transaction.id || !z.iso.date().safeParse(transaction.created_date.slice(0, 10)).success)
    throw new AppError(
      502,
      'Link returned an incomplete transaction. Some data could not be synced.',
      'invalid_link_data',
    );
  return {
    externalId: transaction.id,
    sourceId: transaction.source_id,
    date: transaction.created_date.slice(0, 10),
    description: transaction.description,
    amount: minorAmount(transaction.amount),
    currency: transaction.currency.toUpperCase(),
    category: transaction.category,
    origin: transaction.origin,
    status: transaction.status,
    fetchedAt: now,
  };
}
export function encodeCursor(row: Pick<Transaction, 'date' | 'id'>) {
  return Buffer.from(JSON.stringify([row.date, row.id])).toString('base64url');
}
export function decodeCursor(value: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed[0]) &&
      typeof parsed[1] === 'string' &&
      parsed[1].length <= 200
    )
      return [parsed[0], parsed[1]];
  } catch {
    /* Invalid cursors are user errors, not server errors. */
  }
  throw new AppError(400, 'Invalid transaction cursor.');
}
export async function paginate<T>(
  fetchPage: (cursor?: string) => Promise<{ data: T[]; has_more?: boolean }>,
  cursorOf: (item: T) => string | null | undefined,
  onPage: (items: T[]) => Promise<void>,
) {
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 10000; page++) {
    const result = await fetchPage(cursor);
    await onPage(result.data);
    if (!result.has_more) return;
    const next = result.data.length ? cursorOf(result.data[result.data.length - 1]!) : null;
    if (!next || seen.has(next))
      throw new AppError(
        502,
        'Link pagination stopped unexpectedly. The import is incomplete; refresh to retry.',
        'incomplete_pagination',
      );
    seen.add(next);
    cursor = next;
  }
  throw new AppError(
    502,
    'The import reached its page limit. Saved history is available, but the import is incomplete.',
    'incomplete_pagination',
  );
}
