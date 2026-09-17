import { describe, expect, it } from 'vitest';
import {
  normalizeBalance,
  normalizeSource,
  normalizeTransaction,
  paginate,
  decodeCursor,
  encodeCursor,
  minorAmount,
} from './finance.js';
import { seal, unseal } from './security.js';
import { formatMoney, transactionQuery } from '@sum/contracts';

describe('financial correctness', () => {
  it('formats currency minor units and debit/credit signs correctly', () => {
    expect(formatMoney(-12345, 'usd', true)).toBe('-$123.45');
    expect(formatMoney(12345, 'jpy')).toBe('¥12,345');
    expect(formatMoney(12345, 'kwd')).toContain('12.345');
    expect(formatMoney(120, 'usd', true)).toBe('+$1.20');
    expect(() => minorAmount(1.5)).toThrow();
    expect(() => minorAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
  it('preserves balance semantics and original update time', () => {
    const b = normalizeBalance({
      source_id: 'a',
      type: 'credit',
      current: 50000,
      currency: 'usd',
      credit: { used: { usd: 62000 } },
      as_of: '2026-09-01T00:00:00Z',
    });
    expect(b.current.amount).toBe(50000);
    expect(b.used[0]?.amount).toBe(62000);
    expect(b.available).toEqual([]);
    expect(b.asOf).toBe('2026-09-01T00:00:00Z');
  });
  it('does not guess unassigned accounts or unknown statuses', () => {
    const t = normalizeTransaction(
      {
        id: 't',
        source_id: null,
        amount: -100,
        currency: 'usd',
        created_date: '2026-09-14',
        description: 'Unknown',
        category: null,
        origin: 'link',
        status: 'future_status',
      },
      new Date(),
    );
    expect(t.sourceId).toBeNull();
    expect(t.status).toBe('future_status');
    expect(t.amount).toBe(-100);
  });
  it('retains only safe source metadata', () => {
    const a = normalizeSource(
      {
        id: 'a',
        type: 'card',
        card: { last4: '1234', number: 'sensitive', cvc: 'sensitive' },
        capabilities: { balances: { status: 'eligible' } },
      },
      new Date(),
    );
    expect(a.last4).toBe('1234');
    expect(a.capabilities).toEqual({ balances: 'eligible' });
    expect(JSON.stringify(a)).not.toContain('sensitive');
  });
  it('validates date windows and opaque cursors', () => {
    expect(transactionQuery.safeParse({ start: '2026-03-01', end: '2026-02-01' }).success).toBe(
      false,
    );
    expect(decodeCursor(encodeCursor({ date: '2026-09-01', id: 't1' }))).toEqual([
      '2026-09-01',
      't1',
    ]);
    expect(() => decodeCursor('garbage')).toThrow();
  });
});
describe('pagination', () => {
  it('uses the last item cursor and collects all pages', async () => {
    const requested: (string | undefined)[] = [];
    const found: string[] = [];
    await paginate(
      async (cursor) => {
        requested.push(cursor);
        return cursor
          ? { data: [{ id: 'b' }], has_more: false }
          : { data: [{ id: 'a' }], has_more: true };
      },
      (row) => row.id,
      async (rows) => {
        found.push(...rows.map((r) => r.id));
      },
    );
    expect(requested).toEqual([undefined, 'a']);
    expect(found).toEqual(['a', 'b']);
  });
  it('rejects empty and repeated cursors instead of claiming completion', async () => {
    await expect(
      paginate(
        async () => ({ data: [], has_more: true }),
        () => null,
        async () => {},
      ),
    ).rejects.toThrow('pagination');
    await expect(
      paginate(
        async () => ({ data: [{ id: 'a' }], has_more: true }),
        (row) => row.id,
        async () => {},
      ),
    ).rejects.toThrow('pagination');
  });
});
describe('credential encryption', () => {
  it('round-trips encrypted values and rejects tampering', () => {
    const key = 'ab'.repeat(32);
    const value = seal({ token: 'private' }, key);
    expect(value).not.toContain('private');
    expect(unseal(value, key)).toEqual({ token: 'private' });
    expect(() => unseal(value, 'cd'.repeat(32))).toThrow();
    const parts = value.split('.');
    parts[2] = Buffer.from('corrupted').toString('base64url');
    expect(() => unseal(parts.join('.'), key)).toThrow();
  });
});
