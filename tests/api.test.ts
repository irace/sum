import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, users, credentials, transactions, authFlows } from '@sum/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createApp } from '../apps/api/src/app.js';
import { AppError, unseal } from '../apps/api/src/security.js';
import type { LinkProvider, FinancialClient } from '../apps/api/src/link.js';
const url = process.env.TEST_DATABASE_URL;
const headers = { 'x-sum-client': 'web', origin: 'http://localhost:3003' };

describe.skipIf(!url)('API + PostgreSQL integration', () => {
  const database = createDatabase(url!);
  let instance: Awaited<ReturnType<typeof createApp>>;
  let email = 'alice@example.com';
  let balanceFails = false;
  let badPage = false;
  let slow = false;
  let refreshCalls = 0;
  const calls: (string | undefined)[] = [];
  const fixture: FinancialClient = {
    userInfo: { retrieve: async () => ({ email, name: 'Test user' }) },
    sources: {
      list: async () => ({
        data: [
          {
            id: 'shared-source',
            name: 'Everyday Checking',
            type: 'bank_account',
            bank_account: { last4: '1234', bank_name: 'Test Bank' },
            external_connection: { status: 'active' },
          },
        ],
      }),
    },
    balances: {
      list: async () => {
        if (balanceFails) throw new Error('secret response body');
        return {
          data: [
            {
              source_id: 'shared-source',
              type: 'cash',
              current: 100000,
              currency: 'usd',
              cash: { available: { usd: 95000 } },
              as_of: '2026-09-14T12:00:00Z',
            },
          ],
        };
      },
    },
    transactions: {
      list: async (params) => {
        calls.push(params?.starting_after);
        if (badPage) return { data: [], has_more: true };
        const base = {
          source_id: 'shared-source',
          currency: 'usd',
          category: 'groceries',
          origin: 'external_connection' as const,
          status: 'succeeded',
          created_date: '2026-09-14',
        };
        return params?.starting_after
          ? {
              data: [{ ...base, id: 'tx2', description: 'Paycheck', amount: 200000 }],
              has_more: false,
            }
          : {
              data: [{ ...base, id: 'tx1', description: 'Coffee 100% good', amount: -1234 }],
              has_more: true,
            };
      },
    },
  };
  const provider: LinkProvider = {
    start: async () => ({
      device_code: 'private-device-code',
      user_code: 'moss-lake',
      verification_uri: 'https://app.link.com/verify',
      expires_in: 600,
      interval: 1,
    }),
    poll: async () =>
      slow
        ? 'slow_down'
        : {
            access_token: 'private-access-token',
            refresh_token: 'private-refresh-token',
            expires_in: 3600,
          },
    refresh: async () => {
      refreshCalls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        access_token: `new-access-${refreshCalls}`,
        refresh_token: `new-refresh-${refreshCalls}`,
        expires_in: 3600,
      };
    },
    revoke: async () => {},
    retrieveIdentity: async () => ({ email, name: 'Test user' }),
    client: () => fixture,
  };
  beforeAll(async () => {
    if (!new URL(url!).pathname.endsWith('/sum_test'))
      throw new Error('Integration tests require a dedicated database named sum_test.');
    await migrate(database.db, { migrationsFolder: 'packages/db/drizzle' });
    instance = await createApp(
      database,
      {
        databaseUrl: url!,
        origin: 'http://localhost:3003',
        encryptionKey: 'ab'.repeat(32),
        port: 3003,
        production: false,
        trustProxy: false,
      },
      provider,
    );
    await instance.app.ready();
  });
  beforeEach(async () => {
    await instance.sync.settle();
    await database.pool.query('TRUNCATE users, auth_flows CASCADE');
    email = 'alice@example.com';
    balanceFails = false;
    badPage = false;
    slow = false;
    refreshCalls = 0;
    calls.length = 0;
  });
  afterAll(async () => {
    await instance?.app.close();
    await database.close();
  });
  async function login(as = 'alice@example.com', existingCookie?: string) {
    email = as;
    const start = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/link/start',
      headers: { ...headers, ...(existingCookie ? { cookie: existingCookie } : {}) },
      payload: {},
    });
    expect(start.statusCode).toBe(200);
    expect(start.body).not.toContain('private-device');
    const flow = start.cookies.find((c) => c.name === 'sum_login')!;
    await database.db.update(authFlows).set({ nextPollAt: new Date(0) });
    const poll = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/link/poll',
      headers: { ...headers, cookie: `sum_login=${flow.value}` },
      payload: {},
    });
    return {
      response: poll,
      cookie: `sum_session=${poll.cookies.find((c) => c.name === 'sum_session')?.value}`,
    };
  }
  async function userId(cookie: string) {
    return (await instance.app.inject({ url: '/api/v1/session', headers: { cookie } })).json().user
      .id as string;
  }
  it('requires authentication and protects cross-origin writes', async () => {
    expect((await instance.app.inject('/api/v1/accounts')).statusCode).toBe(401);
    expect(
      (await instance.app.inject({ method: 'POST', url: '/api/v1/auth/link/start', payload: {} }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/v1/auth/link/start',
          headers: { ...headers, origin: 'https://evil.example' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
  it('authenticates, encrypts tokens, binds the challenge, and logs out', async () => {
    const { response, cookie } = await login();
    expect(response.json().status).toBe('authenticated');
    expect(response.body).not.toContain('private');
    const sessionCookie = response.cookies.find((c) => c.name === 'sum_session')!;
    expect(sessionCookie.httpOnly).toBe(true);
    expect(sessionCookie.sameSite).toBe('Lax');
    const [credential] = await database.db.select().from(credentials);
    expect(credential?.encrypted).not.toContain('private');
    expect(unseal(credential!.encrypted, 'ab'.repeat(32))).toMatchObject({
      access_token: 'private-access-token',
    });
    expect(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/v1/auth/link/poll',
          headers,
          payload: {},
        })
      ).json().status,
    ).toBe('expired');
    expect(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          headers: { ...headers, cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await instance.app.inject({ url: '/api/v1/accounts', headers: { cookie } })).statusCode,
    ).toBe(401);
  });
  it('isolates users even with identical provider IDs, pagination, search and categories', async () => {
    const alice = await login();
    const aliceId = await userId(alice.cookie);
    await instance.sync.start(aliceId, true);
    const bob = await login('bob@example.com');
    const bobId = await userId(bob.cookie);
    expect(
      (
        await instance.app.inject({ url: '/api/v1/accounts', headers: { cookie: bob.cookie } })
      ).json().data,
    ).toEqual([]);
    expect(
      (
        await instance.app.inject({ url: '/api/v1/transactions', headers: { cookie: bob.cookie } })
      ).json().data,
    ).toEqual([]);
    expect(
      (
        await instance.app.inject({ url: '/api/v1/filters', headers: { cookie: bob.cookie } })
      ).json().categories,
    ).toEqual([]);
    await instance.sync.start(bobId, true);
    expect((await database.db.select().from(transactions)).length).toBe(4);
    const first = (
      await instance.app.inject({
        url: '/api/v1/transactions?limit=1',
        headers: { cookie: alice.cookie },
      })
    ).json();
    const second = (
      await instance.app.inject({
        url: `/api/v1/transactions?limit=1&cursor=${first.nextCursor}`,
        headers: { cookie: alice.cookie },
      })
    ).json();
    expect(first.data[0].id).not.toBe(second.data[0].id);
    expect(second.nextCursor).toBeNull();
    const matches = (
      await instance.app.inject({
        url: '/api/v1/transactions?q=100%25',
        headers: { cookie: alice.cookie },
      })
    ).json();
    expect(matches.data.length).toBe(1);
    expect(
      (
        await instance.app.inject({
          url: '/api/v1/transactions?start=2026-09-20&end=2026-09-01',
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await instance.app.inject({
          url: '/api/v1/transactions?cursor=bad',
          headers: { cookie: alice.cookie },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('makes sync idempotent, retains balances on failure, reports incomplete history', async () => {
    const { cookie } = await login();
    const id = await userId(cookie);
    await Promise.all([instance.sync.start(id, true), instance.sync.start(id, true)]);
    expect((await database.db.select().from(transactions)).length).toBe(2);
    expect((await instance.sync.state(id)).historyComplete).toBe(true);
    balanceFails = true;
    badPage = true;
    await instance.sync.start(id, true);
    const state = await instance.sync.state(id);
    expect(state.status).toBe('partial');
    expect(state.message).not.toContain('secret');
    const result = await instance.catalog.accounts(id);
    expect(result[0]?.balances[0]?.current.amount).toBe(100000);
    expect((await database.db.select().from(transactions)).length).toBe(2);
  });
  it('marks the first import incomplete when provider pagination fails', async () => {
    const { cookie } = await login();
    const id = await userId(cookie);
    badPage = true;
    await instance.sync.start(id, true);
    expect((await instance.sync.state(id)).historyComplete).toBe(false);
    expect((await instance.sync.state(id)).status).toBe('partial');
  });
  it('does not allow reconnection to replace another user’s identity', async () => {
    const alice = await login();
    const result = await login('bob@example.com', alice.cookie);
    expect(result.response.statusCode).toBe(409);
    expect((await database.db.select().from(users)).length).toBe(1);
  });
  it('coalesces concurrent rotated token refreshes', async () => {
    const { cookie } = await login();
    const id = await userId(cookie);
    await database.db
      .update(credentials)
      .set({ expiresAt: new Date(0) })
      .where(eq(credentials.userId, id));
    const tokens = await Promise.all([
      instance.auth.getAccessToken(id),
      instance.auth.getAccessToken(id),
      instance.auth.getAccessToken(id),
    ]);
    expect(new Set(tokens).size).toBe(1);
    expect(refreshCalls).toBe(1);
  });
});
