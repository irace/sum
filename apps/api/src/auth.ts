import { and, eq, gt, lt } from 'drizzle-orm';
import { authFlows, credentials, sessions, users, type Database } from '@sum/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { LinkProvider, Tokens } from './link.js';
import { AppError, hashToken, opaqueToken, seal, unseal } from './security.js';
import { withLock } from './locks.js';
import { z } from 'zod';

export function createAuth(database: Database, config: Config, provider: LinkProvider) {
  const { db } = database;
  const secure = config.origin.startsWith('https:');
  const cookie = { path: '/api', httpOnly: true, sameSite: 'lax' as const, secure };
  const sessionCookie = secure ? '__Secure-sum_session' : 'sum_session';
  const flowCookie = secure ? '__Secure-sum_login' : 'sum_login';
  async function currentUser(request: FastifyRequest) {
    const token = request.cookies[sessionCookie];
    if (!token) return null;
    const [row] = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.hash, hashToken(token)), gt(sessions.expiresAt, new Date())));
    return row?.user ?? null;
  }
  async function requireUser(request: FastifyRequest) {
    const user = await currentUser(request);
    if (!user) throw new AppError(401, 'Sign in to continue.', 'unauthenticated');
    return user;
  }
  async function saveTokens(userId: string, tokens: Tokens) {
    const row = {
      userId,
      encrypted: seal(tokens, config.encryptionKey),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      needsReconnect: false,
    };
    await db
      .insert(credentials)
      .values(row)
      .onConflictDoUpdate({ target: credentials.userId, set: row });
  }
  async function getAccessToken(userId: string, options?: { forceRefresh?: boolean }) {
    // Serialize refreshes and re-read after locking to honor refresh-token rotation across processes.
    const before = await db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, userId))
      .then((rows) => rows[0]);
    if (!before || before.needsReconnect)
      throw new AppError(401, 'Reconnect Link to resume syncing.', 'reconnect_required');
    if (!options?.forceRefresh && before.expiresAt.getTime() > Date.now() + 60_000)
      return unseal<Tokens>(before.encrypted, config.encryptionKey).access_token;
    return (await withLock(database, `token:${userId}`, async () => {
      const [row] = await db.select().from(credentials).where(eq(credentials.userId, userId));
      if (!row || row.needsReconnect)
        throw new AppError(401, 'Reconnect Link to resume syncing.', 'reconnect_required');
      const tokens = unseal<Tokens>(row.encrypted, config.encryptionKey);
      if (
        row.encrypted !== before.encrypted ||
        (!options?.forceRefresh && row.expiresAt.getTime() > Date.now() + 60_000)
      )
        return tokens.access_token;
      try {
        const fresh = await provider.refresh(tokens.refresh_token);
        await saveTokens(userId, fresh);
        return fresh.access_token;
      } catch (error) {
        if (error instanceof AppError && error.code === 'reconnect_required')
          await db
            .update(credentials)
            .set({ needsReconnect: true })
            .where(eq(credentials.userId, userId));
        throw error;
      }
    }))!;
  }
  return {
    currentUser,
    requireUser,
    saveTokens,
    getAccessToken,
    client: (userId: string) => provider.client((options) => getAccessToken(userId, options)),
    async start(request: FastifyRequest, reply: FastifyReply) {
      const existingUser = await currentUser(request);
      const challenge = await provider.start();
      const token = opaqueToken();
      const expiresAt = new Date(Date.now() + challenge.expires_in * 1000);
      const previous = request.cookies[flowCookie];
      if (previous) await db.delete(authFlows).where(eq(authFlows.hash, hashToken(previous)));
      await db.delete(authFlows).where(lt(authFlows.expiresAt, new Date()));
      await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
      await db.insert(authFlows).values({
        hash: hashToken(token),
        deviceCode: seal(challenge.device_code, config.encryptionKey),
        expiresAt,
        nextPollAt: new Date(Date.now() + challenge.interval * 1000),
        interval: challenge.interval,
        expectedUserId: existingUser?.id,
      });
      reply.setCookie(flowCookie, token, { ...cookie, maxAge: challenge.expires_in });
      const verificationUrl = challenge.verification_uri_complete ?? challenge.verification_uri;
      const url = new URL(verificationUrl);
      if (
        url.protocol !== 'https:' ||
        !(url.hostname === 'link.com' || url.hostname.endsWith('.link.com'))
      )
        throw new AppError(502, 'Link returned an unexpected sign-in address.');
      return {
        verificationUrl,
        userCode: challenge.user_code,
        expiresAt: expiresAt.toISOString(),
        interval: challenge.interval,
      };
    },
    async poll(request: FastifyRequest, reply: FastifyReply) {
      const token = request.cookies[flowCookie];
      if (!token) return { status: 'expired' as const };
      const hash = hashToken(token);
      return await withLock(database, `login:${hash}`, async () => {
        const [flow] = await db.select().from(authFlows).where(eq(authFlows.hash, hash));
        if (!flow || flow.expiresAt < new Date()) {
          reply.clearCookie(flowCookie, cookie);
          return { status: 'expired' as const };
        }
        if (flow.nextPollAt > new Date())
          return { status: 'pending' as const, interval: flow.interval };
        await db
          .update(authFlows)
          .set({ nextPollAt: new Date(Date.now() + flow.interval * 1000) })
          .where(eq(authFlows.hash, hash));
        let result = await provider.poll(unseal<string>(flow.deviceCode, config.encryptionKey));
        if (result === 'slow_down') {
          await db
            .update(authFlows)
            .set({
              interval: flow.interval + 5,
              nextPollAt: new Date(Date.now() + (flow.interval + 5) * 1000),
            })
            .where(eq(authFlows.hash, hash));
          return { status: 'pending' as const, interval: flow.interval + 5 };
        }
        if (result === 'pending') return { status: 'pending' as const, interval: flow.interval };
        if (result === 'expired' || result === 'denied') {
          await db.delete(authFlows).where(eq(authFlows.hash, hash));
          reply.clearCookie(flowCookie, cookie);
          return { status: result };
        }
        let info: {
          email?: string | null;
          name?: string | null;
          first_name?: string | null;
        };
        let identityRetried = false;
        try {
          try {
            info = await provider.retrieveIdentity(result.access_token);
          } catch (error) {
            if (error instanceof AppError && error.code === 'link_identity_unauthorized') {
              identityRetried = true;
              const refreshed = await provider.refresh(result.refresh_token);
              result = { ...result, ...refreshed };
              info = await provider.retrieveIdentity(refreshed.access_token);
            } else {
              throw error;
            }
          }
        } catch (error) {
          await db.delete(authFlows).where(eq(authFlows.hash, hash));
          if (error instanceof AppError) {
            if (identityRetried) error.meta = { ...error.meta, identityRetried: true };
            throw error;
          }
          throw new AppError(
            502,
            'Link approved the connection, but Sum could not read your Link identity. Please try again.',
            'link_identity_failed',
          );
        }
        // The current SDK exposes email, not a stable subject ID. Never accept identity from the browser.
        const parsedEmail = z.email().safeParse(info.email?.trim().toLowerCase());
        if (!parsedEmail.success) {
          await db.delete(authFlows).where(eq(authFlows.hash, hash));
          throw new AppError(
            502,
            'Your Link account must have an email address to use Sum.',
            'identity_unavailable',
          );
        }
        const email = parsedEmail.data;
        if (flow.expectedUserId) {
          const [expected] = await db.select().from(users).where(eq(users.id, flow.expectedUserId));
          if (!expected || expected.email !== email) {
            await db.delete(authFlows).where(eq(authFlows.hash, hash));
            throw new AppError(
              409,
              'Reconnect with the same Link account, or sign out to switch accounts.',
              'identity_mismatch',
            );
          }
        }
        const sessionToken = opaqueToken();
        try {
          await db.transaction(async (tx) => {
            const [user] = await tx
              .insert(users)
              .values({ email, name: info.name ?? info.first_name ?? null })
              .onConflictDoUpdate({
                target: users.email,
                set: { name: info.name ?? info.first_name ?? null },
              })
              .returning();
            if (!user) throw new Error('User creation failed.');
            const row = {
              userId: user.id,
              encrypted: seal(result, config.encryptionKey),
              expiresAt: new Date(Date.now() + result.expires_in * 1000),
              needsReconnect: false,
            };
            await tx
              .insert(credentials)
              .values(row)
              .onConflictDoUpdate({ target: credentials.userId, set: row });
            await tx.insert(sessions).values({
              hash: hashToken(sessionToken),
              userId: user.id,
              expiresAt: new Date(Date.now() + 30 * 86400_000),
            });
            const oldSession = request.cookies[sessionCookie];
            if (oldSession)
              await tx.delete(sessions).where(eq(sessions.hash, hashToken(oldSession)));
            await tx.delete(authFlows).where(eq(authFlows.hash, hash));
          });
        } catch (error) {
          await db.delete(authFlows).where(eq(authFlows.hash, hash));
          throw new AppError(
            503,
            'Link approved the connection, but Sum could not finish creating your workspace. Please try again.',
            'workspace_creation_failed',
          );
        }
        reply.setCookie(sessionCookie, sessionToken, { ...cookie, maxAge: 30 * 86400 });
        reply.clearCookie(flowCookie, cookie);
        return { status: 'authenticated' as const };
      });
    },
    async logout(request: FastifyRequest, reply: FastifyReply) {
      const token = request.cookies[sessionCookie];
      if (token) await db.delete(sessions).where(eq(sessions.hash, hashToken(token)));
      const flow = request.cookies[flowCookie];
      if (flow) await db.delete(authFlows).where(eq(authFlows.hash, hashToken(flow)));
      reply.clearCookie(sessionCookie, cookie).clearCookie(flowCookie, cookie);
      return { ok: true };
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;
